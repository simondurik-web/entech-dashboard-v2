import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { getBinContents } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/bin-contents?warehouse=<bin>
// Everything stored in one bin: each item with its on-hand qty and the pallet ids
// in that bin. Read-only; powers the Locations view + the bin audit report.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// A very large single bin enriches many pallets (bounded concurrency); give it headroom.
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const warehouse = req.nextUrl.searchParams.get('warehouse')?.trim() ?? ''
  if (!warehouse) {
    return NextResponse.json({ error: 'warehouse is required' }, { status: 400 })
  }

  try {
    const { items, palletsTruncated } = await getBinContents(warehouse)
    const total = items.reduce((s, i) => s + i.qty, 0)
    return NextResponse.json(
      { warehouse, items, total, palletsTruncated },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('bin-contents lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
