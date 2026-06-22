import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { getFullInventory } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/report
// The full item × bin × qty matrix for the whole facility. Read-only; the client
// builds the grouped (By Bin / By Product) Excel workbook from it.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The full export enriches every pallet across the facility (bounded concurrency), so it
// can run long on a large inventory — allow up to 5 min (Vercel clamps to the plan max).
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  try {
    const rows = await getFullInventory()
    return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('inventory report failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
