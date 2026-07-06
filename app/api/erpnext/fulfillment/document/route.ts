import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextFetchRaw, erpnextGetDoc } from '@/lib/erpnext/client'
import { BOL_FORMAT, PACKING_SLIP_FORMAT } from '@/lib/erpnext/fulfillment'

// GET /api/erpnext/fulfillment/document?dn=<DN>&type=bol|packing
// Streams the BOL / packing slip PDF for a Delivery Note — used by the success
// screen ("open PDF" for AirPrint/office printing, Simon's Q2 decision) and by
// reprint from the shipped view. Regenerated from the print format on every
// call, so it always reflects the document as ERPNext knows it.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/

export async function GET(req: NextRequest) {
  // Ship flow ('/staged'), Shipping Overview / Shipped views, or PO Automation.
  let guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) guard = await requireMenuAccess(req, '/shipping-overview')
  if (!guard.ok) guard = await requireMenuAccess(req, '/po-automation')
  if (!guard.ok) return guard.res

  const dn = req.nextUrl.searchParams.get('dn')?.trim() ?? ''
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!DN_NAME.test(dn) || !['bol', 'packing'].includes(type)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    // only serve documents for real, submitted DNs tied to a Sales Order — not
    // arbitrary guessed Delivery Notes. DNs scanned natively in ERPNext carry
    // the SO link on their items (against_sales_order), not the wrapper's
    // custom_ship_against_so field — both count (Simon 2026-07-06: every
    // shipped order's BOL/packing slip must be downloadable).
    const doc = await erpnextGetDoc<{
      docstatus: number
      custom_ship_against_so?: string | null
      items?: { against_sales_order?: string | null }[]
    }>('Delivery Note', dn)
    const soLinked =
      !!doc.custom_ship_against_so || (doc.items ?? []).some((i) => !!i.against_sales_order)
    if (doc.docstatus !== 1 || !soLinked) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 })
    }

    const format = type === 'bol' ? BOL_FORMAT : PACKING_SLIP_FORMAT
    const qs = new URLSearchParams({ doctype: 'Delivery Note', name: dn, format })
    const upstream = await erpnextFetchRaw(`/api/method/frappe.utils.print_format.download_pdf?${qs}`)
    if (!upstream.ok) return NextResponse.json({ error: 'Not available' }, { status: 502 })
    const bytes = await upstream.arrayBuffer()
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${type === 'bol' ? 'BOL' : 'PackingSlip'}-${dn}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('fulfillment document failed:', error)
    return NextResponse.json({ error: 'Not available' }, { status: 502 })
  }
}
