import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { lookupPallet } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/pallet-lookup?code=<scanned-or-typed>
// Resolve a pallet code to a transfer-queue line (current serial, item, source bin, qty).
// Returns { pallet: null } when the code isn't a stocked pallet. Read-only; auth-gated.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const code = req.nextUrl.searchParams.get('code')?.trim() ?? ''
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  try {
    const pallet = await lookupPallet(code)
    return NextResponse.json({ pallet }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('pallet-lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
