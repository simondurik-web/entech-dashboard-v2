import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { erpnextPut, parseErpErrorMessage } from '@/lib/erpnext/client'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Set an item's minimum (ERPNext Item.safety_stock — the SOURCE OF TRUTH for
// dashboard minimums since 2026-07-07; production_totals.minimums is a frozen
// sheet-era fallback). Also patches the Supabase `inventory` row so the UI
// reflects the change immediately instead of waiting for the 5-min ERP sync.
// ERPNext records who/when via Item versioning (dashboard-svc + this route's
// verified user in the response).
export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: { partNumber?: unknown; minimum?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const partNumber = String(body.partNumber ?? '').trim().toUpperCase()
  const minimum = Number(body.minimum)
  if (!partNumber || partNumber.length > 140) {
    return NextResponse.json({ error: 'partNumber required' }, { status: 400 })
  }
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 10_000_000 || !Number.isInteger(minimum)) {
    return NextResponse.json({ error: 'minimum must be a whole number >= 0' }, { status: 400 })
  }

  try {
    await erpnextPut(`/api/resource/Item/${encodeURIComponent(partNumber)}`, { safety_stock: minimum })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = msg.includes('-> 404') ? 404 : 502
    return NextResponse.json(
      { error: status === 404 ? `Item ${partNumber} not found in ERPNext` : parseErpErrorMessage(msg) },
      { status }
    )
  }

  // Best-effort immediate mirror; ERPNext is the source of truth and the 5-min
  // sync converges regardless — a mirror failure is reported, not fatal.
  const { error: sbErr } = await supabaseAdmin
    .from('inventory')
    .update({ minimum })
    .ilike('item_number', partNumber)
  if (sbErr) console.error('minimum mirror update failed:', sbErr.message)

  return NextResponse.json({ ok: true, partNumber, minimum, mirrored: !sbErr, by: guard.email })
}
