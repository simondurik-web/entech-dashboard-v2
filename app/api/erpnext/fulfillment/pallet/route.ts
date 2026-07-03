import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { lookupPalletForFulfillment } from '@/lib/erpnext/fulfillment'

// GET /api/erpnext/fulfillment/pallet?id=<pallet/batch id>
// Diagnoses a scanned pallet that isn't in the order's staged set so the Ship
// Order screen can say WHY it's red (wrong product / another order / unknown /
// disabled label). Read-only; no prices. Gated on '/staged' menu access.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PALLET_ID = /^[A-Za-z0-9-]{1,40}$/

export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res

  const id = req.nextUrl.searchParams.get('id')?.trim().toUpperCase() ?? ''
  if (!PALLET_ID.test(id)) {
    return NextResponse.json({ error: 'Invalid pallet id' }, { status: 400 })
  }
  try {
    const full = await lookupPalletForFulfillment(id)
    // Slim response: only what the mismatch UI needs — no on-hand quantities
    // or reservation customer names (enumeration hardening, codex review).
    const pallet = {
      palletId: full.palletId,
      itemCode: full.itemCode,
      disabled: full.disabled,
      reservedTo: full.reservedTo ? { so: full.reservedTo.so } : null,
    }
    return NextResponse.json({ pallet }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('fulfillment pallet lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
