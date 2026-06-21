import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { listWarehouses } from '@/lib/erpnext/client'

// GET /api/erpnext/inventory/warehouses?q=  -> bins for the Add form dropdown.
// `default` is pre-selected when the user doesn't pick one.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_WAREHOUSE = 'Finished Goods - M'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  try {
    const warehouses = await listWarehouses(q)
    const def = warehouses.includes(DEFAULT_WAREHOUSE) ? DEFAULT_WAREHOUSE : warehouses[0] ?? null
    return NextResponse.json({ warehouses, default: def }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('list warehouses failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
