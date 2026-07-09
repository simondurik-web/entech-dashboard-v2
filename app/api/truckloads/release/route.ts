import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireMenuAccess } from '@/lib/erpnext/auth'
import { resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTruckload, rollupTruckloadStatus, ACTIVE_TL_STATUSES } from '@/lib/truckloads'

// Manager override (decision 3, Simon 2026-07-08: hard block + manager
// override): pull ONE order out of a truckload so it can ship alone.
//
// Two ways in:
//  1. The caller's own session has manage_truckloads -> release directly.
//  2. A shipping-team phone at the block screen: a manager types THEIR OWN
//     dashboard email+password. We verify those credentials server-side
//     (signInWithPassword against the same Supabase auth) and check THAT
//     account's manage_truckloads. The floor user's session never changes;
//     the manager's password never persists.
// Every release is logged with the authorizing manager's name.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f-]{36}$/

async function roleHasTruckloadAccess(userId: string): Promise<{ ok: boolean; name: string | null }> {
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', 'dashboard')
    .single()
  const role = appRole?.role ?? 'visitor'
  if (role === 'admin' || role === 'super_admin') return { ok: true, name: null }
  const { data: perm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', role)
    .single()
  const menu = (perm?.menu_access ?? {}) as Record<string, boolean>
  return { ok: menu['manage_truckloads'] === true, name: null }
}

export async function POST(req: NextRequest) {
  // ship_loads: the floor user must at least be someone who can ship — the
  // override then needs a manager on top of that.
  const guard = await requireMenuAccess(req, 'ship_loads')
  if (!guard.ok) return guard.res

  let body: { truckloadId?: unknown; orderKey?: unknown; managerEmail?: unknown; managerPassword?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const truckloadId = String(body.truckloadId ?? '')
  const orderKey = String(body.orderKey ?? '').trim()
  if (!UUID.test(truckloadId) || !orderKey) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  try {
    // Who authorizes? The caller themselves, or the manager credentials.
    let authorizerId = guard.userId
    let authorizerLabel = (await resolveUserName(guard.userId)) || guard.email
    const selfCheck = await roleHasTruckloadAccess(guard.userId)
    if (!selfCheck.ok) {
      const email = String(body.managerEmail ?? '').trim().toLowerCase()
      const password = String(body.managerPassword ?? '')
      if (!email || !password) {
        return NextResponse.json({ error: 'manager_required' }, { status: 403 })
      }
      // Throwaway client: verify the manager's credentials without touching
      // the floor user's session or any cookie state.
      const authClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      const { data: signIn, error: signErr } = await authClient.auth.signInWithPassword({ email, password })
      const manager = signIn?.user
      if (signErr || !manager) {
        return NextResponse.json({ error: 'Wrong manager email or password' }, { status: 403 })
      }
      const mgrCheck = await roleHasTruckloadAccess(manager.id)
      if (!mgrCheck.ok) {
        return NextResponse.json({ error: 'That account cannot authorize truckload overrides' }, { status: 403 })
      }
      await authClient.auth.signOut().catch(() => {})
      authorizerId = manager.id
      authorizerLabel = (await resolveUserName(manager.id)) || email
    }

    const tl = await getTruckload(truckloadId)
    if (!tl) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(ACTIVE_TL_STATUSES as readonly string[]).includes(tl.status)) {
      return NextResponse.json({ error: 'This truckload is already closed' }, { status: 409 })
    }
    const order = tl.truckload_orders.find((o) => o.order_key === orderKey && o.status === 'pending')
    if (!order) return NextResponse.json({ error: 'Order not found in this truckload' }, { status: 404 })

    const { error } = await supabaseAdmin
      .from('truckload_orders')
      .update({ status: 'released', released_by: authorizerLabel, released_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('status', 'pending')
    if (error) throw new Error(error.message)
    await rollupTruckloadStatus(truckloadId)

    logFulfillment({
      action: 'tl_release',
      so: order.so_number,
      dn: tl.load_number,
      customer: order.customer ?? undefined,
      userId: authorizerId,
      userName: authorizerLabel,
      detail: `released from ${tl.load_number} (requested by ${guard.email})`,
    })
    return NextResponse.json({ ok: true, releasedBy: authorizerLabel }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('truckload release failed:', error)
    return NextResponse.json({ error: 'Override failed. Try again.' }, { status: 502 })
  }
}
