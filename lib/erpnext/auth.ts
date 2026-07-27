import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/require-user'

// Server-side access guard for the ERPNext inventory routes.
//
// HARDENED (Simon 2026-06-21): identity comes from the VERIFIED Supabase session
// (the Authorization: Bearer <access_token> the dashboard sends), validated here
// with supabaseAdmin.auth.getUser(). The old forgeable `x-user-id` header is NOT
// trusted for identity any more — so the recorded "who did it" (labels + history)
// can't be spoofed. Returns the verified user id + email so routes attribute
// actions to the real person. Shared floor devices have no Supabase session, so
// they can't pass this guard (read-only by construction, unchanged).

const INVENTORY_OPS_PATH = '/inventory-ops'

type Guard =
  | { ok: true; role: string; userId: string; email: string }
  | { ok: false; res: NextResponse }


export async function requireInventoryAccess(req: NextRequest): Promise<Guard> {
  return requireMenuAccess(req, INVENTORY_OPS_PATH)
}

/** Same hardened guard, gated on any role_permissions menu path. The fulfillment
 *  (Ship Order) routes use '/staged' — access to the Ready to Ship page is what
 *  grants the shipping flow (admin + the shipping roles). */
export async function requireMenuAccess(req: NextRequest, menuPath: string): Promise<Guard> {
  // Identity comes from the shared requireUser (2026-07-27). This used to
  // verify the token itself and read user_profiles without is_active, so a
  // deactivated user kept write access to ~35 inventory and fulfillment routes
  // until their token expired. Sharing the one verifier means this guard cannot
  // drift from the rest of the app again.
  const authedUser = await requireUser(req)
  if (!authedUser) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const userId = authedUser.id
  const email = authedUser.email ?? ''

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role')
    .eq('id', userId)
    .single()
  if (!profile) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // App-specific role overlay (same as getProfileFromHeader in scheduling).
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', 'dashboard')
    .single()
  // Access requires an explicit dashboard app-role; no enrollment -> visitor.
  const role: string = appRole?.role ?? 'visitor'

  if (role === 'admin' || role === 'super_admin') return { ok: true, role, userId, email }

  const { data: perm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', role)
    .single()
  const menu = (perm?.menu_access ?? {}) as Record<string, boolean>
  if (menu[menuPath] === true) return { ok: true, role, userId, email }

  return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
}
