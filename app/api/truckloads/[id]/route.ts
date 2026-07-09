import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { conflictingOrderKeys, getTruckload, ACTIVE_TL_STATUSES } from '@/lib/truckloads'

// One truckload — GET full (incl. calculator snapshot for the load sheet /
// re-opening in the calculator), PATCH edit (notes, snapshot, add/remove
// orders, cancel). Sales keeps the flexibility to reshape a planned truck
// (decision: Phil can edit until shipping starts; even during loading he can
// still add/remove the not-yet-shipped orders).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f-]{36}$/
const SO_NAME = /^[A-Za-z0-9-]{1,40}$/

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireMenuAccess(req, '/staged')
  if (!guard.ok) return guard.res
  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  try {
    const truckload = await getTruckload(id)
    if (!truckload) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ truckload }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('truckload get failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}

interface AddOrder {
  soNumber: string
  orderKey: string
  ifNumber?: string
  customer?: string
  partNumber?: string
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireMenuAccess(req, 'manage_truckloads')
  if (!guard.ok) return guard.res
  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  let body: {
    notes?: unknown
    calculatorState?: unknown
    addOrders?: unknown
    removeOrderKeys?: unknown
    cancel?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    const tl = await getTruckload(id)
    if (!tl) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(ACTIVE_TL_STATUSES as readonly string[]).includes(tl.status)) {
      return NextResponse.json({ error: 'This truckload is closed and can no longer be edited' }, { status: 409 })
    }
    const userName = (await resolveUserName(guard.userId)) || guard.email

    if (body.cancel === true) {
      const shipped = tl.truckload_orders.some((o) => o.status === 'shipped')
      if (shipped) {
        return NextResponse.json(
          { error: 'Part of this truckload already shipped — remove the remaining orders instead of canceling' },
          { status: 409 }
        )
      }
      await supabaseAdmin
        .from('truckloads')
        .update({ status: 'canceled', canceled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
      logFulfillment({ action: 'tl_cancel', so: tl.truckload_orders.map((o) => o.so_number).join(','), dn: tl.load_number, userId: guard.userId, userName })
      return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 2000)
    if (body.calculatorState !== undefined) patch.calculator_state = body.calculatorState

    const removeKeys = Array.isArray(body.removeOrderKeys)
      ? (body.removeOrderKeys as unknown[]).map((k) => String(k)).filter(Boolean)
      : []
    if (removeKeys.length) {
      // only pending rows can leave; shipped history stays on the truckload
      const { error } = await supabaseAdmin
        .from('truckload_orders')
        .delete()
        .eq('truckload_id', id)
        .eq('status', 'pending')
        .in('order_key', removeKeys)
      if (error) throw new Error(error.message)
    }

    const addOrders = (Array.isArray(body.addOrders) ? (body.addOrders as AddOrder[]) : [])
      .map((o) => ({
        soNumber: String(o.soNumber ?? '').trim(),
        orderKey: String(o.orderKey ?? '').trim(),
        ifNumber: String(o.ifNumber ?? '').trim() || null,
        customer: String(o.customer ?? '').trim() || null,
        partNumber: String(o.partNumber ?? '').trim() || null,
      }))
      .filter((o) => o.orderKey && SO_NAME.test(o.soNumber))
      .filter((o) => !tl.truckload_orders.some((ex) => ex.order_key === o.orderKey))
    if (addOrders.length) {
      const conflicts = await conflictingOrderKeys(addOrders.map((o) => o.orderKey), id)
      if (conflicts.size > 0) {
        const [key, other] = [...conflicts.entries()][0]
        return NextResponse.json({ error: `Order ${key.split('||')[0]} is already in ${other}` }, { status: 409 })
      }
      const basePos = Math.max(-1, ...tl.truckload_orders.map((o) => o.position)) + 1
      const { error } = await supabaseAdmin.from('truckload_orders').insert(
        addOrders.map((o, i) => ({
          truckload_id: id,
          so_number: o.soNumber,
          order_key: o.orderKey,
          if_number: o.ifNumber,
          customer: o.customer,
          part_number: o.partNumber,
          position: basePos + i,
        }))
      )
      if (error) throw new Error(error.message)
    }

    // an edit can leave the truck with a single (or zero) pending order — the
    // remaining count is surfaced, canceling entirely is the salesman's call
    await supabaseAdmin.from('truckloads').update(patch).eq('id', id)
    if (removeKeys.length || addOrders.length) {
      logFulfillment({
        action: 'tl_edit',
        so: tl.truckload_orders.map((o) => o.so_number).join(','),
        dn: tl.load_number,
        userId: guard.userId,
        userName,
        detail: `+${addOrders.length} / -${removeKeys.length}`,
      })
    }
    const truckload = await getTruckload(id)
    return NextResponse.json({ truckload }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('truckload update failed:', error)
    return NextResponse.json({ error: 'Could not update the truckload. Try again.' }, { status: 502 })
  }
}
