import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextGet, erpnextGetDoc } from '@/lib/erpnext/client'
import { findSignedBolObjects, truckloadSiblingBolDoc } from '@/lib/erpnext/external-bol'
import { escapeLike } from '@/lib/po-automation/edit'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/erpnext/fulfillment/shipping-docs?so=<SO>
// Lists the submitted Delivery Notes behind a Sales Order so the dashboard can
// offer the generated BOL / packing slip downloads (streamed on demand by
// /api/erpnext/fulfillment/document — regenerated from the ERPNext print
// format, so they always reflect current truth, signatures included).
// Covers BOTH fulfillment-wrapper DNs (custom_ship_against_so) and DNs scanned
// natively in ERPNext (linked only via items.against_sales_order) — that's what
// makes every shipped order's documents available, past and future.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

export async function GET(req: NextRequest) {
  // Same audiences that see the PO / BOL section: shipping pages or PO automation.
  let guard = await requireMenuAccess(req, '/shipping-overview')
  if (!guard.ok) guard = await requireMenuAccess(req, '/po-automation')
  if (!guard.ok) return guard.res

  const so = req.nextUrl.searchParams.get('so')?.trim() ?? ''
  if (!SO_NAME.test(so)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const [byField, byItems] = await Promise.all([
      erpnextGet<{ data: { name: string }[] }>(
        `/api/resource/Delivery%20Note?${listParam('filters', [
          ['docstatus', '=', 1],
          ['custom_ship_against_so', '=', so],
        ])}&${listParam('fields', ['name'])}&limit_page_length=0`
      ).catch(() => ({ data: [] })),
      erpnextGet<{ data: { parent: string }[] }>(
        // child-table REST requires the parent doctype param (Frappe v15)
        `/api/resource/Delivery%20Note%20Item?parent=${encodeURIComponent('Delivery Note')}&${listParam('filters', [
          ['against_sales_order', '=', so],
          ['docstatus', '=', 1],
        ])}&${listParam('fields', ['parent'])}&limit_page_length=0`
      ).catch(() => ({ data: [] })),
    ])
    const names = [...new Set([
      ...(byField.data ?? []).map((d) => d.name),
      ...(byItems.data ?? []).map((d) => d.parent),
    ])]
    if (names.length === 0) {
      return NextResponse.json({ documents: [] }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const details = await erpnextGet<{
      data: { name: string; posting_date: string; custom_shipped?: number }[]
    }>(
      `/api/resource/Delivery%20Note?${listParam('filters', [
        ['name', 'in', names],
        ['docstatus', '=', 1],
      ])}&${listParam('fields', ['name', 'posting_date', 'custom_shipped'])}&limit_page_length=0`
    )
    // Carrier (external) BOL availability — an order-level dashboard upload, a
    // CustomerBOL attached to the DN, or an already-stamped signed copy. Powers
    // the "Carrier BOL" reprint button in the Shipped view.
    const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
    let hasOrderBol = false
    try {
      const soDoc = await erpnextGetDoc<{ customer?: string | null; po_no?: string | null }>('Sales Order', so)
      if (soDoc.po_no) {
        const { data: docs } = await supabaseAdmin
          .schema('po_automation')
          .from('order_documents')
          .select('customer')
          .eq('doc_type', 'bol')
          .ilike('po_number', escapeLike(soDoc.po_no.trim()))
          .limit(25)
        const want = norm(soDoc.customer)
        hasOrderBol = (docs ?? []).some((d) => norm(d.customer) === want)
      }
    } catch {
      /* best-effort flag */
    }
    if (!hasOrderBol) {
      // one carrier BOL per truckload — a sibling member's upload counts
      try {
        hasOrderBol = !!(await truckloadSiblingBolDoc(so))
      } catch {
        /* best-effort flag */
      }
    }
    const [dnBols, signedLists] = await Promise.all([
      erpnextGet<{ data: { attached_to_name: string }[] }>(
        `/api/resource/File?${listParam('filters', [
          ['attached_to_doctype', '=', 'Delivery Note'],
          ['attached_to_name', 'in', names],
          ['file_name', 'like', 'CustomerBOL-%'],
        ])}&${listParam('fields', ['attached_to_name'])}&limit_page_length=0`
      ).catch(() => ({ data: [] })),
      Promise.all(names.map(async (n) => ((await findSignedBolObjects(n)).length ? n : null))),
    ])
    const dnBolSet = new Set((dnBols.data ?? []).map((f) => f.attached_to_name))
    const signedSet = new Set(signedLists.filter(Boolean) as string[])

    const documents = (details.data ?? [])
      .sort((a, b) => (a.posting_date < b.posting_date ? 1 : -1))
      .map((d) => ({
        dn: d.name,
        date: d.posting_date,
        shipped: !!d.custom_shipped,
        customerBol: hasOrderBol || dnBolSet.has(d.name) || signedSet.has(d.name),
      }))
    return NextResponse.json({ documents }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('shipping-docs lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
