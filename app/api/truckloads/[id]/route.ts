import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { attachCustomerPartNumbers, conflictingOrderKeys, conflictingOrderLines, distinctCustomers, getTruckload, ACTIVE_TL_STATUSES } from '@/lib/truckloads'
import { getFulfillmentOrder } from '@/lib/erpnext/fulfillment'

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
    // ?pallets=1 (load sheet): live staged pallet IDs per member line, from the
    // reservations — scoped to the member's SO Item like the ship flow
    if (req.nextUrl.searchParams.get('pallets') === '1') {
      // the load sheet also prints the customer's own part numbers
      await attachCustomerPartNumbers(truckload.truckload_orders)
      const soNames = [...new Set(truckload.truckload_orders.filter((o) => o.status === 'pending').map((o) => o.so_number))]
      const bySo = new Map<string, Awaited<ReturnType<typeof getFulfillmentOrder>>>()
      await Promise.all(
        soNames.map(async (so) => {
          try {
            bySo.set(so, await getFulfillmentOrder(so))
          } catch {
            /* member SO unreadable -> its pallet list stays empty */
          }
        })
      )
      for (const o of truckload.truckload_orders) {
        const pallets = bySo.get(o.so_number)?.pallets ?? []
        ;(o as unknown as { pallet_ids?: string[] }).pallet_ids = o.so_item
          ? pallets.filter((p) => p.soDetail === o.so_item).map((p) => p.palletId)
          : pallets.map((p) => p.palletId)
      }
    }
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
  palletCount?: number
  line?: number
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
        palletCount: Number.isFinite(Number(o.palletCount)) && Number(o.palletCount) > 0
          ? Math.min(999, Math.round(Number(o.palletCount)))
          : null,
        line: Number.isInteger(Number(o.line)) && Number(o.line) > 0 ? Number(o.line) : null,
      }))
      .filter((o) => o.orderKey && SO_NAME.test(o.soNumber))
      .filter((o) => !tl.truckload_orders.some((ex) => ex.order_key === o.orderKey))
    if (addOrders.length) {
      const conflicts = await conflictingOrderKeys(addOrders.map((o) => o.orderKey), id)
      if (conflicts.size > 0) {
        const [key, other] = [...conflicts.entries()][0]
        return NextResponse.json({ error: `Order ${key.split('||')[0]} is already in ${other}` }, { status: 409 })
      }
      // one LINE = one truckload (key guard misses multi-release lines)
      const lineConflicts = await conflictingOrderLines(
        addOrders.map((o) => o.line).filter((l): l is number => l != null),
        id
      )
      if (lineConflicts.size > 0) {
        const [line, other] = [...lineConflicts.entries()][0]
        return NextResponse.json(
          { error: `Line ${line} is already on ${other} — a line ships on exactly one truckload` },
          { status: 409 }
        )
      }
      // one truckload ships ONE customer — added orders must match the
      // remaining members (removed keys no longer count)
      const removedKeys = new Set(removeKeys)
      const customers = distinctCustomers([
        ...tl.truckload_orders
          .filter((o) => !(o.status === 'pending' && removedKeys.has(o.order_key)))
          .map((o) => o.customer),
        ...addOrders.map((o) => o.customer),
      ])
      if (customers.length > 1) {
        return NextResponse.json(
          { error: `One truckload ships ONE customer — this change mixes ${customers.join(' + ')}` },
          { status: 409 }
        )
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
          pallet_count: o.palletCount,
          line: o.line,
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
