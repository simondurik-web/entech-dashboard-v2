import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextFetchRaw, erpnextGetDoc } from '@/lib/erpnext/client'
import { ExternalBolUnsupportedError, fetchExternalBolPdf, resolveDnShipment } from '@/lib/erpnext/external-bol'
import { BOL_FORMAT, PACKING_SLIP_FORMAT } from '@/lib/erpnext/fulfillment'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'
import { allowedStationIds, userCanPrintTo } from '@/lib/erpnext/printer-access'
import { supabaseAdmin } from '@/lib/supabase-admin'

// BOL / packing-slip printing through the print relay, onto a station's
// LETTER-paper printer (e.g. the shipping Canon) — Simon 2026-07-03: the floor
// devices can't reach that printer directly, but the station Mac can. The PDF
// travels base64 in print_jobs (format='pdf'); the station agent decodes and
// prints via CUPS (no raw).
//
// GET  -> stations that have a letter printer AND the user may print to.
// POST { dn, type: bol|packing, station } -> enqueue the print job.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res
  const { data, error } = await supabaseAdmin
    .from('print_stations')
    .select('id, name, letter_printer')
    .eq('enabled', true)
    .not('letter_printer', 'is', null)
    .order('name')
  if (error) return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  const allowed = await allowedStationIds(guard.userId, guard.role)
  const stations = (data ?? [])
    .filter((s) => allowed === 'all' || allowed.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }))
  return NextResponse.json({ stations }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: { dn?: string; type?: string; station?: string; copies?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const dn = String(body.dn ?? '').trim()
  const type = String(body.type ?? '')
  const station = String(body.station ?? '').trim()
  // Shipping needs two of everything (Simon 2026-07-08) — the UI defaults to 2,
  // the relay honors 1-5. One print_jobs row per copy: zero station-agent changes.
  const copies = Math.min(5, Math.max(1, Number(body.copies) || 1))
  if (!DN_NAME.test(dn) || !['bol', 'packing', 'customer_bol'].includes(type) || !station) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const { data: st } = await supabaseAdmin
      .from('print_stations')
      .select('id, letter_printer')
      .eq('id', station)
      .eq('enabled', true)
      .single()
    if (!st?.letter_printer) {
      return NextResponse.json({ error: 'That station has no paper printer' }, { status: 400 })
    }
    if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
      return NextResponse.json({ error: 'Not allowed to print to this station' }, { status: 403 })
    }

    // Same linkage rule as the view route: wrapper DNs carry
    // custom_ship_against_so, natively-scanned DNs link via their items.
    const doc = await erpnextGetDoc<{
      docstatus: number
      custom_ship_against_so?: string | null
      customer?: string
      items?: { against_sales_order?: string | null }[]
    }>('Delivery Note', dn)
    const soLinked =
      doc.custom_ship_against_so || (doc.items ?? []).map((i) => i.against_sales_order).find(Boolean) || null
    if (doc.docstatus !== 1 || !soLinked) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    let bytes: Uint8Array
    if (type === 'customer_bol') {
      // Carrier-provided BOL — the signature-stamped copy when one exists
      const ref = await resolveDnShipment(dn)
      const ext = ref ? await fetchExternalBolPdf(ref) : null
      if (!ext) return NextResponse.json({ error: 'No external BOL on this order' }, { status: 404 })
      // print_jobs carries the PDF base64 in a table row — keep huge uploads out
      if (ext.bytes.length > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'File too large for the relay — use View + AirPrint' }, { status: 413 })
      }
      bytes = ext.bytes
    } else {
      const format = type === 'bol' ? BOL_FORMAT : PACKING_SLIP_FORMAT
      const qs = new URLSearchParams({ doctype: 'Delivery Note', name: dn, format })
      const upstream = await erpnextFetchRaw(`/api/method/frappe.utils.print_format.download_pdf?${qs}`)
      if (!upstream.ok) return NextResponse.json({ error: 'Could not generate the PDF' }, { status: 502 })
      bytes = new Uint8Array(await upstream.arrayBuffer())
      if (!(bytes.length > 4 && bytes[0] === 0x25)) {
        return NextResponse.json({ error: 'Could not generate the PDF' }, { status: 502 })
      }
    }

    const payload = Buffer.from(bytes).toString('base64')
    const stamp = Date.now()
    const { error } = await supabaseAdmin.from('print_jobs').insert(
      Array.from({ length: copies }, (_, i) => ({
        station_id: station,
        format: 'pdf',
        zpl: payload,
        item_code: type === 'bol' ? 'BOL' : type === 'customer_bol' ? 'CUSTOMER-BOL' : 'PACKING-SLIP',
        batch: dn,
        created_by: guard.userId,
        idempotency_key: `doc-${dn}-${type}-${stamp}-${i + 1}`, // reprints are intentional
        status: 'pending',
      }))
    )
    if (error) throw new Error(error.message)

    logFulfillment({
      action: 'print_document',
      so: soLinked,
      dn,
      customer: doc.customer,
      userId: guard.userId,
      detail: `${type} ×${copies} @ ${station}`,
    })
    return NextResponse.json({ queued: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ExternalBolUnsupportedError) {
      return NextResponse.json({ error: 'unsupported_format' }, { status: 422 })
    }
    console.error('print document failed:', error)
    return NextResponse.json({ error: 'Print failed. Try again.' }, { status: 502 })
  }
}
