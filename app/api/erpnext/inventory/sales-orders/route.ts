import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { listSalesOrdersForItem } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/sales-orders?itemCode=<code>
// Open Sales Orders that include this item, so a label can be attached to the right order
// (filtered by product so the dropdown shows only the SOs that take that part). Read-only.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const itemCode = req.nextUrl.searchParams.get('itemCode')?.trim() ?? ''
  if (!itemCode) {
    return NextResponse.json({ error: 'itemCode is required' }, { status: 400 })
  }
  try {
    const salesOrders = await listSalesOrdersForItem(itemCode)
    return NextResponse.json({ salesOrders }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Sales-order lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
