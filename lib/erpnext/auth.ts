import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') ?? ''
  // Case-insensitive scheme match (proxies/clients may normalize the header case).
  return /^bearer /i.test(h) ? h.slice(7).trim() || null : null
}

export async function requireInventoryAccess(req: NextRequest): Promise<Guard> {
  const token = bearer(req)
  if (!token) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // Verify the JWT and derive identity from it (not from any client header).
  const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
  const authedUser = authData?.user
  if (authErr || !authedUser) {
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
  const role: string = appRole?.role ?? profile.role ?? 'visitor'

  if (role === 'admin' || role === 'super_admin') return { ok: true, role, userId, email }

  const { data: perm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', role)
    .single()
  const menu = (perm?.menu_access ?? {}) as Record<string, boolean>
  if (menu[INVENTORY_OPS_PATH] === true) return { ok: true, role, userId, email }

  return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
}
