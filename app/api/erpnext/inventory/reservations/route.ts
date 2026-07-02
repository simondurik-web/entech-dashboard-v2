import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { reservationsForBatches } from '@/lib/erpnext/staging'

// GET /api/erpnext/inventory/reservations?batches=b1,b2,...
// For the given pallet batches, returns which are reserved to a Sales Order, live from
// ERPNext (SO#, customer, PO, reserved qty, status). Batches with no active reservation
// are absent from the map. Read-only; auth-gated.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const raw = req.nextUrl.searchParams.get('batches')?.trim() ?? ''
  const batches = raw ? raw.split(',').map((b) => b.trim()).filter(Boolean) : []
  if (batches.length === 0) {
    return NextResponse.json({ reservations: {} }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const reservations = await reservationsForBatches(batches)
    return NextResponse.json({ reservations }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('ERPNext reservations lookup failed:', error)
    return NextResponse.json({ reservations: {}, error: 'Lookup failed' }, { status: 502 })
  }
}
