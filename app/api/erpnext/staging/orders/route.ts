import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { listOpenSalesOrdersForItem } from '@/lib/erpnext/staging'

// GET /api/erpnext/staging/orders?itemCode=<code>
// Open Sales Orders that include this item, each with ordered-vs-reserved qty so the operator
// can pick the order to reserve pallets against and see staging progress. Read-only; auth-gated.

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
    const salesOrders = await listOpenSalesOrdersForItem(itemCode)
    return NextResponse.json({ salesOrders }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('staging orders lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
