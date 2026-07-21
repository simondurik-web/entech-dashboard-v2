import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { canManageShippingBol } from '@/lib/po-automation/guard'
import { ACTIVE_TL_STATUSES } from '@/lib/truckloads'
import { normalizeStatus } from '@/lib/google-sheets-shared'
import { escapeLike } from '@/lib/po-automation/edit'

// Shipment scheduling — planned carrier + scheduled ship date per Sales Order
// (Simon 2026-07-21). Values live on dashboard_orders (dashboard-managed
// columns; the ERPNext sync never touches them) and apply to every line of the
// SO. If the SO rides an active truckload, the schedule fans out to every
// member SO — one truck, one carrier, one pickup date.
//
// GET  ?so=  -> { carrier, scheduledShipDate, setBy, setAt, truckloadSos }
// POST { so, carrier, scheduledShipDate } -> set (null/empty clears); returns
//   the full fanned-out SO list so the UI can show what was updated.

export const dynamic = 'force-dynamic'

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/

/** Real calendar day in YYYY-MM-DD (shape + round-trip; rejects 2026-02-30). */
function isValidDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Pending member SOs of the SO's ACTIVE truckload (planned/loading), own SO
 *  excluded. Deliberately NOT the broader truckloadSiblingSos used for BOL
 *  invalidation — that one spans historical/shipped truckloads, and a schedule
 *  write must never touch a truck that already left. Truckload membership is
 *  line-scoped, so one SO's lines CAN ride different active trucks — that
 *  state is ambiguous for a per-SO schedule, so fan-out only happens when the
 *  membership resolves to exactly ONE active truckload; otherwise the caller
 *  gets multi=true and schedules just the requested SO (review panel
 *  2026-07-21, codex BLOCKERs rounds 1-2). */
async function activeTruckloadMemberSos(
  so: string
): Promise<{ sos: string[]; skipped?: string[]; multi: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('truckload_orders')
    .select('truckload_id, status, truckloads!inner(status)')
    .eq('so_number', so)
    .eq('status', 'pending')
    .in('truckloads.status', [...ACTIVE_TL_STATUSES])
  if (error) throw new Error(error.message)
  const tlIds = [...new Set((data ?? []).map((r) => r.truckload_id).filter(Boolean))]
  if (tlIds.length === 0) return { sos: [], multi: false }
  if (tlIds.length > 1) return { sos: [], multi: true }
  const { data: members, error: mErr } = await supabaseAdmin
    .from('truckload_orders')
    .select('so_number')
    .eq('truckload_id', tlIds[0])
    .eq('status', 'pending')
  if (mErr) throw new Error(mErr.message)
  const candidates = [...new Set((members ?? []).map((m) => m.so_number).filter((s): s is string => !!s && s !== so))]
  if (candidates.length === 0) return { sos: [], multi: false }
  // A sibling can ALSO ride another active truck (line-scoped membership) —
  // writing its schedule here would silently overwrite that other truck's
  // schedule for it. Ambiguous siblings are excluded from the fan-out
  // (review panel 2026-07-21, codex round 3).
  const { data: memberTls, error: mtErr } = await supabaseAdmin
    .from('truckload_orders')
    .select('so_number, truckload_id, truckloads!inner(status)')
    .in('so_number', candidates)
    .eq('status', 'pending')
    .in('truckloads.status', [...ACTIVE_TL_STATUSES])
  if (mtErr) throw new Error(mtErr.message)
  const tlsBySo = new Map<string, Set<string>>()
  for (const r of memberTls ?? []) {
    const s = r.so_number as string
    if (!tlsBySo.has(s)) tlsBySo.set(s, new Set())
    if (r.truckload_id) tlsBySo.get(s)!.add(String(r.truckload_id))
  }
  return {
    sos: candidates.filter((s) => (tlsBySo.get(s)?.size ?? 0) <= 1),
    skipped: candidates.filter((s) => (tlsBySo.get(s)?.size ?? 0) > 1),
    multi: false,
  }
}

async function guardAny(req: NextRequest) {
  let guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) guard = await requireMenuAccess(req, '/shipping-overview')
  if (!guard.ok) guard = await requireMenuAccess(req, '/orders')
  if (!guard.ok) guard = await requireMenuAccess(req, '/po-automation')
  return guard
}

/** dashboard_orders row ids belonging to an SO (if_number first-token match).
 *  Shipped rows are excluded — a schedule is pre-ship planning data and must
 *  not rewrite history after the load leaves (review panel 2026-07-21).
 *  "Shipped" uses the app-wide normalizeStatus (covers Invoiced / To Bill /
 *  case variants) plus a shipped_date belt. */
async function lineIdsForSo(so: string): Promise<{ ids: number[]; shippedOnly: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('dashboard_orders')
    .select('id, if_number, work_order_status, if_status_fusion, shipped_date')
    .ilike('if_number', `${escapeLike(so)}%`)
    .limit(1000)
  if (error) throw new Error(error.message)
  const rows = (data ?? []).filter((r) => String(r.if_number ?? '').trim().split(/\s+/)[0] === so)
  // Scheduling targets live orders: shipped is history, cancelled is dead —
  // neither is writable (round-6 review).
  const live = rows.filter((r) => {
    const st = normalizeStatus(String(r.work_order_status ?? ''), String(r.if_status_fusion ?? ''))
    return st !== 'shipped' && st !== 'cancelled' && !String(r.shipped_date ?? '').trim()
  })
  return { ids: live.map((r) => r.id as number), shippedOnly: rows.length > 0 && live.length === 0 }
}

export async function GET(req: NextRequest) {
  const guard = await guardAny(req)
  if (!guard.ok) return guard.res

  const so = req.nextUrl.searchParams.get('so')?.trim() ?? ''
  if (!SO_NAME.test(so)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const { data, error } = await supabaseAdmin
      .from('dashboard_orders')
      .select('if_number, scheduled_carrier, scheduled_ship_date, schedule_set_by, schedule_set_at')
      .ilike('if_number', `${escapeLike(so)}%`)
      .limit(200)
    if (error) throw new Error(error.message)
    const rows = (data ?? []).filter((r) => String(r.if_number ?? '').trim().split(/\s+/)[0] === so)
    if (rows.length === 0) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    // Lines of one SO always carry the same schedule (writes fan out) — a mixed
    // state can only come from rows added after a set; prefer the freshest set.
    const row =
      [...rows].sort((a, b) => String(b.schedule_set_at ?? '').localeCompare(String(a.schedule_set_at ?? '')))[0] ?? rows[0]
    const tl = await activeTruckloadMemberSos(so)
    return NextResponse.json(
      {
        carrier: row.scheduled_carrier ?? null,
        scheduledShipDate: row.scheduled_ship_date ?? null,
        setBy: row.schedule_set_by ?? null,
        setAt: row.schedule_set_at ?? null,
        truckloadSos: tl.sos,
        multiTruckload: tl.multi,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('schedule GET failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardAny(req)
  if (!guard.ok) return guard.res
  // Writes: Admin / Manager / Shipping Manager only (Simon 2026-07-21).
  if (!(await canManageShippingBol(guard.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { so?: string; carrier?: unknown; scheduledShipDate?: unknown; expectedSetAt?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const so = String(body.so ?? '').trim()
  const carrier = String(body.carrier ?? '').trim().slice(0, 60) || null
  const dateRaw = String(body.scheduledShipDate ?? '').trim()
  if (!SO_NAME.test(so) || (dateRaw && !isValidDay(dateRaw))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  // Carrier lands in CSV exports — a leading =, +, -, @ or control char would
  // execute as a formula when the export opens in Excel (round-6 review).
  if (carrier && /^[=+\-@\t\r]/.test(carrier)) {
    return NextResponse.json({ error: 'Carrier name cannot start with =, +, - or @' }, { status: 400 })
  }
  const scheduledShipDate = dateRaw || null

  try {
    const own = await lineIdsForSo(so)
    if (own.shippedOnly) return NextResponse.json({ error: 'Order already shipped' }, { status: 409 })
    if (own.ids.length === 0) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    // One truck, one schedule: ACTIVE-truckload members ride along (skipped —
    // with a notice — when the SO's lines span multiple active trucks).
    const tl = await activeTruckloadMemberSos(so)
    const allIds = [...own.ids]
    const sos = [so]
    for (const sib of tl.sos) {
      const { ids } = await lineIdsForSo(sib)
      if (ids.length) {
        allIds.push(...ids)
        sos.push(sib)
      }
    }

    const setBy = (await resolveUserName(guard.userId)) || guard.email || null
    // Atomic compare-and-set in ONE transaction (scripts/dashboard-orders-
    // schedule.sql): locks the token rows, re-reads max(schedule_set_at),
    // refuses on mismatch, updates with a shipped-row guard. A plain
    // check-then-write let two same-token saves both pass (review panel
    // 2026-07-21, codex R5). The token compares/returns the STORED Postgres
    // representation, so client echoes always round-trip exactly.
    const enforce = 'expectedSetAt' in body
    const expected = body.expectedSetAt == null ? null : String(body.expectedSetAt)
    const { data: casRows, error } = await supabaseAdmin.rpc('set_order_schedule', {
      p_check_ids: own.ids,
      p_all_ids: allIds,
      p_carrier: carrier,
      p_date: scheduledShipDate,
      p_set_by: setBy,
      p_expected: expected,
      p_enforce: enforce,
    })
    if (error) throw new Error(error.message)
    const cas = Array.isArray(casRows) ? casRows[0] : casRows
    if (cas?.conflict) {
      return NextResponse.json({ error: 'conflict' }, { status: 409 })
    }
    const setAt = cas?.new_set_at ?? null

    // The Shipping Overview blob is unstable_cache'd (60s) — expire it NOW so
    // a saved schedule shows there immediately. (This Next version's
    // revalidateTag REQUIRES the 2nd arg — the 1-arg form fails tsc; a profile
    // of {expire: 0} is immediate expiry, not stale-while-revalidate.)
    revalidateTag('shipping-overview', { expire: 0 })

    return NextResponse.json(
      {
        ok: true,
        sos,
        skippedSos: tl.skipped ?? [],
        updatedLines: cas?.updated ?? 0,
        carrier,
        scheduledShipDate,
        multiTruckload: tl.multi,
        setAt,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('schedule POST failed:', error)
    return NextResponse.json({ error: 'Could not save the schedule. Try again.' }, { status: 502 })
  }
}
