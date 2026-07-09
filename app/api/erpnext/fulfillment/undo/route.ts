import { NextRequest, NextResponse } from 'next/server'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { undoShipment, ShipmentRejectedError } from '@/lib/erpnext/fulfillment'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment, flipDashboardStatus } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { rollupTruckloadStatus } from '@/lib/truckloads'

// POST /api/erpnext/fulfillment/undo  { dn }
// Reverts a shipment completed by accident: cancels the Delivery Note, which
// returns the stock to the pallets, restores the order's reservations, and
// rolls the SO staging status back (Simon 2026-07-02, Q3 note).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DN_NAME = /^[A-Za-z0-9-]{1,40}$/

export async function POST(req: NextRequest) {
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: { dn?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const dn = String(body.dn ?? '').trim()
  if (!DN_NAME.test(dn)) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const result = await undoShipment(dn)
    // If this DN was shipped as part of a truckload, put the order back into
    // the truck (pending) so the chained flow / banners stay truthful.
    try {
      const { data: tlRows } = await supabaseAdmin
        .from('truckload_orders')
        .select('id, truckload_id')
        .eq('dn_number', dn)
        .eq('status', 'shipped')
      for (const row of tlRows ?? []) {
        await supabaseAdmin
          .from('truckload_orders')
          .update({ status: 'pending', dn_number: null })
          .eq('id', row.id)
        // a shipped truckload reopens to loading when one of its DNs is undone
        await supabaseAdmin
          .from('truckloads')
          .update({ status: 'loading', shipped_at: null, updated_at: new Date().toISOString() })
          .eq('id', row.truckload_id)
          .eq('status', 'shipped')
        await rollupTruckloadStatus(row.truckload_id)
      }
    } catch (e) {
      console.error('truckload undo bookkeeping failed:', e)
    }
    const userName = await resolveUserName(guard.userId)
    if (result.so) {
      logFulfillment({
        action: 'undo',
        so: result.so,
        dn,
        userId: guard.userId,
        userName: userName || guard.email,
      })
      flipDashboardStatus(result.so, 'staged', result.soItems)
    }
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ShipmentRejectedError) {
      return NextResponse.json({ error: error.message, rejected: true }, { status: 422 })
    }
    console.error('undo shipment failed:', error)
    return NextResponse.json({ error: 'Undo failed. Try again.' }, { status: 502 })
  }
}
