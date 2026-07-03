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
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res

  const dn = req.nextUrl.searchParams.get('dn')?.trim() ?? ''
  const type = req.nextUrl.searchParams.get('type') ?? ''
  if (!DN_NAME.test(dn) || !['bol', 'packing'].includes(type)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    // only serve documents for real, submitted DNs
    const doc = await erpnextGetDoc<{ docstatus: number }>('Delivery Note', dn)
    if (doc.docstatus !== 1) return NextResponse.json({ error: 'Not available' }, { status: 404 })

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
