import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { getFulfillmentOrder } from '@/lib/erpnext/fulfillment'

// GET /api/erpnext/fulfillment/order?so=<Sales Order name>
// Read-only fulfillment view for the Ship Order screen: order header, lines
// (item, ordered/delivered/staged qty — NO prices), and the staged pallets.
// Gated on '/staged' menu access (the Ready to Ship page's own gate).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res

  const so = req.nextUrl.searchParams.get('so')?.trim() ?? ''
  if (!SO_NAME.test(so)) {
    return NextResponse.json({ error: 'Invalid sales order' }, { status: 400 })
  }
  try {
    const order = await getFulfillmentOrder(so)
    return NextResponse.json({ order }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const notFound = error instanceof Error && error.message.includes('-> 404')
    if (!notFound) console.error('fulfillment order lookup failed:', error)
    return NextResponse.json(
      { error: notFound ? 'Order not found' : 'Lookup failed' },
      { status: notFound ? 404 : 502 }
    )
  }
}
