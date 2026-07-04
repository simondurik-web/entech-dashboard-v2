import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { completeShipment, getFulfillmentOrder, ShipmentRejectedError } from '@/lib/erpnext/fulfillment'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment, flipDashboardStatus } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

  let body: { so?: string; pallets?: unknown }
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
    })
    lockDone = true
    // audit + instant section hop (best-effort; the 5-min sync self-heals)
    logFulfillment({
      action: 'complete',
      so,
      dn: result.dn,
      customer: order.customer,
      pallets,
      userId: guard.userId,
      userName: userName || guard.email,
    })
    flipDashboardStatus(
      so,
      'shipped',
      order.pallets.map((p) => p.soDetail).filter((s): s is string => !!s)
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
