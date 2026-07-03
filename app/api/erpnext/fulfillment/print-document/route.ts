import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextFetchRaw, erpnextGetDoc } from '@/lib/erpnext/client'
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

  let body: { dn?: string; type?: string; station?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const dn = String(body.dn ?? '').trim()
  const type = String(body.type ?? '')
  const station = String(body.station ?? '').trim()
  if (!DN_NAME.test(dn) || !['bol', 'packing'].includes(type) || !station) {
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

    const doc = await erpnextGetDoc<{ docstatus: number; custom_ship_against_so?: string | null; customer?: string }>(
      'Delivery Note',
      dn
    )
    if (doc.docstatus !== 1 || !doc.custom_ship_against_so) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    const format = type === 'bol' ? BOL_FORMAT : PACKING_SLIP_FORMAT
    const qs = new URLSearchParams({ doctype: 'Delivery Note', name: dn, format })
    const upstream = await erpnextFetchRaw(`/api/method/frappe.utils.print_format.download_pdf?${qs}`)
    if (!upstream.ok) return NextResponse.json({ error: 'Could not generate the PDF' }, { status: 502 })
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (!(bytes.length > 4 && bytes[0] === 0x25)) {
      return NextResponse.json({ error: 'Could not generate the PDF' }, { status: 502 })
    }

    const { error } = await supabaseAdmin.from('print_jobs').insert({
      station_id: station,
      format: 'pdf',
      zpl: Buffer.from(bytes).toString('base64'),
      item_code: type === 'bol' ? 'BOL' : 'PACKING-SLIP',
      batch: dn,
      created_by: guard.userId,
      idempotency_key: `doc-${dn}-${type}-${Date.now()}`, // reprints are intentional
      status: 'pending',
    })
    if (error) throw new Error(error.message)

    logFulfillment({
      action: 'print_document',
      so: doc.custom_ship_against_so,
      dn,
      customer: doc.customer,
      userId: guard.userId,
      detail: `${type} @ ${station}`,
    })
    return NextResponse.json({ queued: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('print document failed:', error)
    return NextResponse.json({ error: 'Print failed. Try again.' }, { status: 502 })
  }
}
