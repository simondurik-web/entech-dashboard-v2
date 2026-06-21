import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Server-side access guard for the ERPNext routes. Mirrors the client
// usePermissions().canAccess('/inventory-ops') check so the API can't be hit
// directly without the same role the UI requires. Uses the x-user-id header
// the dashboard sends on authed requests (same pattern as the scheduling/admin
// routes).

const INVENTORY_OPS_PATH = '/inventory-ops'

type Guard = { ok: true; role: string } | { ok: false; res: NextResponse }

export async function requireInventoryAccess(req: NextRequest): Promise<Guard> {
  const userId = req.headers.get('x-user-id')
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

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

  if (role === 'admin' || role === 'super_admin') return { ok: true, role }

  const { data: perm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', role)
    .single()
  const menu = (perm?.menu_access ?? {}) as Record<string, boolean>
  if (menu[INVENTORY_OPS_PATH] === true) return { ok: true, role }

  return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
}
