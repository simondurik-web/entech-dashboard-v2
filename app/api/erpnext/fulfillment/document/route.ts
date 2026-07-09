import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextFetchRaw, erpnextGetDoc } from '@/lib/erpnext/client'
import { BOL_FORMAT, PACKING_SLIP_FORMAT } from '@/lib/erpnext/fulfillment'

// GET /api/erpnext/fulfillment/document?dn=<DN>&type=bol|packing&copies=2
// Streams the BOL / packing slip PDF for a Delivery Note — used by the success
// screen ("open PDF" for AirPrint/office printing, Simon's Q2 decision) and by
// reprint from the shipped view. Regenerated from the print format on every
// call, so it always reflects the document as ERPNext knows it.
//
// copies (1-5; default prints are queued with 2 per Simon 2026-07-08): pages
// are duplicated INSIDE the returned PDF, so a single AirPrint job from an
// iPhone yields every copy — no extra taps, no manual photocopying.

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
    let bytes = await upstream.arrayBuffer()

    const copies = Math.min(5, Math.max(1, parseInt(req.nextUrl.searchParams.get('copies') ?? '1', 10) || 1))
    if (copies > 1) {
      try {
        const src = await PDFDocument.load(bytes)
        const out = await PDFDocument.create()
        for (let c = 0; c < copies; c++) {
          const pages = await out.copyPages(src, src.getPageIndices())
          pages.forEach((p) => out.addPage(p))
        }
        bytes = (await out.save()).buffer as ArrayBuffer
      } catch (e) {
        // a malformed PDF must still be viewable — fall back to a single copy
        console.error('pdf copies duplication failed:', e)
      }
    }
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
