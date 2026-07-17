import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { completeShipment, getFulfillmentOrder, ShipmentRejectedError } from '@/lib/erpnext/fulfillment'
import { erpnextUpdate } from '@/lib/erpnext/client'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment, flipDashboardStatus } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTruckload, rollupTruckloadStatus } from '@/lib/truckloads'

// POST /api/erpnext/fulfillment/complete  { so, pallets: string[] }
// The "Complete Shipment" tap. The scanned pallet set is revalidated server-
// side against the live staged records; the DN submit fires ERPNext's scan
// safety gate. Customer part numbers for the packing slip come from the
// dashboard's customer_part_mappings (the same source po-bot resolves from).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60 // DN submit + 2 PDFs + uploads can exceed the default

const SO_NAME = /^[A-Za-z0-9-]{1,40}$/
const PALLET_ID = /^[A-Za-z0-9-]{1,40}$/

async function customerPartNosFor(customer: string, itemCodes: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!itemCodes.length) return out
  const { data: cust } = await supabaseAdmin
    .from('customers')
    .select('id')
    .ilike('name', customer)
    .limit(1)
  const customerId = cust?.[0]?.id
  if (!customerId) return out
  const { data: rows } = await supabaseAdmin
    .from('customer_part_mappings')
    .select('internal_part_number, customer_part_number')
    .eq('customer_id', customerId)
    .in('internal_part_number', itemCodes)
  for (const r of rows ?? []) {
    if (r.customer_part_number) out[r.internal_part_number] = r.customer_part_number
  }
  return out
}

export async function POST(req: NextRequest) {
  // ship_loads: the action permission Simon grants per role ("Ship Loads") —
  // page visibility (/staged) alone does NOT allow completing shipments
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: { so?: string; pallets?: unknown; truckloadId?: unknown; orderKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const so = String(body.so ?? '').trim()
  const pallets = Array.isArray(body.pallets) ? body.pallets.map((p) => String(p).trim().toUpperCase()) : []
  if (!SO_NAME.test(so) || pallets.length === 0 || pallets.some((p) => !PALLET_ID.test(p))) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Truckload context (chained flow): verify the SO really is a pending member
  // BEFORE shipping, so the TL number stamped on the BOL can't be spoofed by
  // the client and the truckload bookkeeping stays consistent.
  const truckloadId = body.truckloadId ? String(body.truckloadId) : null
  const orderKey = typeof body.orderKey === 'string' && body.orderKey.trim() ? body.orderKey.trim() : null
  let truckloadNumber: string | null = null
  // line scope: the member's SO Item — scan + DN cover only that line's pallets
  let soDetail: string | null = null
  let memberOrderKey: string | null = null
  if (truckloadId) {
    if (!/^[0-9a-f-]{36}$/.test(truckloadId)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    try {
      const tl = await getTruckload(truckloadId)
      const member = tl?.truckload_orders.find(
        (o) => o.status === 'pending' && (orderKey ? o.order_key === orderKey : o.so_number === so)
      )
      if (!tl || !member || member.so_number !== so || (tl.status !== 'planned' && tl.status !== 'loading')) {
        return NextResponse.json({ error: 'This order is not a pending part of that truckload' }, { status: 409 })
      }
      truckloadNumber = tl.load_number
      memberOrderKey = member.order_key
      soDetail = member.so_item ?? null
    } catch (e) {
      console.error('truckload check failed:', e)
      return NextResponse.json({ error: 'Truckload lookup failed. Try again.' }, { status: 502 })
    }
  }

  // Per-SO mutual exclusion for the single most destructive tap: two stations
  // completing the same order in the same second both passed findExistingDn
  // (a read) and raced the DN create (bug-hunt 2026-07-04). Reuses the ops-log
  // partial unique index on `family` (in-flight statuses): the loser gets 409.
  // The row is released in finally; sequential retries stay idempotent via
  // findExistingDn as before.
  const lockKey = `ship-${so}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { error: lockErr } = await supabaseAdmin.from('inventory_ops_log').insert({
    idempotency_key: lockKey,
    action: 'ship-complete',
    status: 'pending',
    created_by: guard.userId,
    warehouse: so,
    family: `SHIP-${so}`,
  })
  if (lockErr) {
    if (lockErr.code === '23505') {
      return NextResponse.json(
        { error: 'This order is already being completed on another device. Give it a few seconds, then refresh.' },
        { status: 409 }
      )
    }
    console.error('ship lock insert failed:', lockErr)
    return NextResponse.json({ error: 'Could not start the shipment. Try again.' }, { status: 502 })
  }
  let lockDone = false

  try {
    // customer + items come from the live order inside completeShipment; the
    // mapping query needs them too, so read the customer from ERPNext once here.
    const userName = await resolveUserName(guard.userId)
    const order = await getFulfillmentOrder(so)
    const customerPartNos = await customerPartNosFor(
      order.customer,
      [...new Set(order.lines.map((l) => l.itemCode))]
    )
    const result = await completeShipment({
      soName: so,
      scannedPallets: pallets,
      userName: userName || guard.email,
      customerPartNos,
      soDetail,
    })
    lockDone = true

    // Truckload bookkeeping + BOL stamp (both best-effort; the shipment itself
    // is already submitted and must never be failed retroactively).
    if (truckloadId && truckloadNumber) {
      try {
        await supabaseAdmin
          .from('truckload_orders')
          .update({ status: 'shipped', dn_number: result.dn })
          .eq('truckload_id', truckloadId)
          .eq('order_key', memberOrderKey ?? '')
          .eq('status', 'pending')
        await rollupTruckloadStatus(truckloadId)
      } catch (e) {
        console.error('truckload bookkeeping failed:', e)
      }
      try {
        // allow_on_submit custom field; shows the TL number on the BOL +
        // packing slip (decision 5, Simon 2026-07-08)
        await erpnextUpdate('Delivery Note', result.dn, { custom_truckload_no: truckloadNumber })
      } catch (e) {
        console.error('truckload DN stamp failed (field missing?):', e)
      }
    }

    // audit + instant section hop (best-effort; the 5-min sync self-heals)
    logFulfillment({
      action: 'complete',
      so,
      dn: result.dn,
      customer: order.customer,
      pallets,
      userId: guard.userId,
      userName: userName || guard.email,
      detail:
        [
          truckloadNumber ? `truckload ${truckloadNumber}` : null,
          result.releasedSres.length ? `auto-released stale reservations: ${result.releasedSres.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('; ') || null,
    })
    flipDashboardStatus(
      so,
      'shipped',
      order.pallets
        .filter((p) => !soDetail || p.soDetail === soDetail)
        .map((p) => p.soDetail)
        .filter((s): s is string => !!s)
    )
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ShipmentRejectedError) {
      return NextResponse.json({ error: error.message, rejected: true }, { status: 422 })
    }
    console.error('complete shipment failed:', error)
    return NextResponse.json({ error: 'Shipment failed — nothing was submitted. Try again.' }, { status: 502 })
  } finally {
    await supabaseAdmin
      .from('inventory_ops_log')
      .update({ status: lockDone ? 'done' : 'failed' })
      .eq('idempotency_key', lockKey)
      .then(undefined, (e) => console.error('ship lock release failed:', e))
  }
}
