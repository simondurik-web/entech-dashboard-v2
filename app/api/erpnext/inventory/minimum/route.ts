import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { erpnextGet, erpnextPut, parseErpErrorMessage } from '@/lib/erpnext/client'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveUserName } from '@/lib/erpnext/operation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Minimums (ERPNext Item.safety_stock — the SOURCE OF TRUTH for dashboard
// minimums since 2026-07-07). Editing is restricted to the `edit_minimums`
// permission (manager / shipping_manager / admin; Simon 2026-07-08), and every
// change is recorded in minimum_change_log (who, old -> new, when). Note:
// edits made directly on the ERPNext Item form bypass this log — ERPNext's own
// document versioning covers those.

// POST { partNumber, minimum } — set a minimum. Writes ERPNext, mirrors the
// Supabase `inventory` row for instant UI, and appends the audit row.
export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'edit_minimums')
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

  // Old value for the audit trail — read from ERPNext (authoritative). A read
  // failure only costs the old value, never blocks the edit.
  let oldMinimum: number | null = null
  try {
    const item = await erpnextGet<{ data: { safety_stock?: number } }>(
      `/api/resource/Item/${encodeURIComponent(partNumber)}?fields=["safety_stock"]`
    )
    oldMinimum = Math.round(Number(item.data?.safety_stock ?? 0))
  } catch {
    /* audit row will carry old_minimum = null */
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

  // Audit row — the change is committed in ERPNext at this point, so a log
  // failure is reported in the response but doesn't undo anything.
  const changedByName = await resolveUserName(guard.userId).catch(() => '')
  const { error: logErr } = await supabaseAdmin.from('minimum_change_log').insert({
    part_number: partNumber,
    old_minimum: oldMinimum,
    new_minimum: minimum,
    changed_by_id: guard.userId,
    changed_by_email: guard.email,
    changed_by_name: changedByName || guard.email,
  })
  if (logErr) console.error('minimum audit log insert failed:', logErr.message)

  // Best-effort immediate mirror; ERPNext is the source of truth and the 5-min
  // sync converges regardless — a mirror failure is reported, not fatal.
  const { error: sbErr } = await supabaseAdmin
    .from('inventory')
    .update({ minimum })
    .ilike('item_number', partNumber)
  if (sbErr) console.error('minimum mirror update failed:', sbErr.message)

  return NextResponse.json({
    ok: true, partNumber, minimum, oldMinimum,
    mirrored: !sbErr, logged: !logErr, by: guard.email,
  })
}

// GET ?partNumber=&limit= — the change log, newest first. Same permission as
// editing (the people who can change minimums are the ones who review them).
export async function GET(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'edit_minimums')
  if (!guard.ok) return guard.res

  const partNumber = (req.nextUrl.searchParams.get('partNumber') ?? '').trim().toUpperCase()
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 100))

  let query = supabaseAdmin
    .from('minimum_change_log')
    .select('part_number, old_minimum, new_minimum, changed_by_name, changed_by_email, changed_at')
    .order('changed_at', { ascending: false })
    .limit(limit)
  if (partNumber) query = query.eq('part_number', partNumber)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
