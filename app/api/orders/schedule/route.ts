import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { canManageShippingBol } from '@/lib/po-automation/guard'
import { truckloadSiblingSos } from '@/lib/erpnext/external-bol'
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
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/

async function guardAny(req: NextRequest) {
  let guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) guard = await requireMenuAccess(req, '/shipping-overview')
  if (!guard.ok) guard = await requireMenuAccess(req, '/orders')
  if (!guard.ok) guard = await requireMenuAccess(req, '/po-automation')
  return guard
}

/** dashboard_orders row ids belonging to an SO (if_number first-token match). */
async function lineIdsForSo(so: string): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from('dashboard_orders')
    .select('id, if_number')
    .ilike('if_number', `${escapeLike(so)}%`)
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter((r) => String(r.if_number ?? '').trim().split(/\s+/)[0] === so)
    .map((r) => r.id as number)
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
    const truckloadSos = await truckloadSiblingSos(so)
    return NextResponse.json(
      {
        carrier: row.scheduled_carrier ?? null,
        scheduledShipDate: row.scheduled_ship_date ?? null,
        setBy: row.schedule_set_by ?? null,
        setAt: row.schedule_set_at ?? null,
        truckloadSos,
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

  let body: { so?: string; carrier?: unknown; scheduledShipDate?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const so = String(body.so ?? '').trim()
  const carrier = String(body.carrier ?? '').trim().slice(0, 60) || null
  const dateRaw = String(body.scheduledShipDate ?? '').trim()
  if (!SO_NAME.test(so) || (dateRaw && !DATE_SHAPE.test(dateRaw))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const scheduledShipDate = dateRaw || null

  try {
    const ownIds = await lineIdsForSo(so)
    if (ownIds.length === 0) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    // One truck, one schedule: active-truckload members ride along.
    const siblings = await truckloadSiblingSos(so)
    const allIds = [...ownIds]
    const sos = [so]
    for (const sib of siblings) {
      const ids = await lineIdsForSo(sib)
      if (ids.length) {
        allIds.push(...ids)
        sos.push(sib)
      }
    }

    const setBy = (await resolveUserName(guard.userId)) || guard.email || null
    const { error } = await supabaseAdmin
      .from('dashboard_orders')
      .update({
        scheduled_carrier: carrier,
        scheduled_ship_date: scheduledShipDate,
        schedule_set_by: setBy,
        schedule_set_at: new Date().toISOString(),
      })
      .in('id', allIds)
    if (error) throw new Error(error.message)

    return NextResponse.json(
      { ok: true, sos, updatedLines: allIds.length, carrier, scheduledShipDate },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('schedule POST failed:', error)
    return NextResponse.json({ error: 'Could not save the schedule. Try again.' }, { status: 502 })
  }
}
