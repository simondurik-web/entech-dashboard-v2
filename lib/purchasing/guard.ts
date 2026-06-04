import { supabaseAdmin } from '@/lib/supabase-admin'

const DASHBOARD_APP_ID = 'dashboard'

/**
 * Server-side replica of usePermissions().canAccess('/purchasing').
 * Write endpoints must enforce this — the page's AccessGuard is client-side
 * only and the x-user-id header is client-supplied, so the API cannot trust
 * the UI gate alone.
 *
 * IMPORTANT: the effective dashboard role is the user's user_app_roles entry
 * for the "dashboard" app overlaid on user_profiles.role — exactly what
 * /api/auth/profile does. Reading user_profiles.role alone wrongly denied
 * managers assigned via user_app_roles (their profile.role can be a lower
 * default like "visitor").
 */
export async function canAccessPurchasing(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, custom_permissions, is_active')
    .eq('id', userId)
    .single()

  if (!profile || profile.is_active === false) return false

  // Overlay the dashboard app-role over the global profile role (mirrors /api/auth/profile).
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', DASHBOARD_APP_ID)
    .maybeSingle()
  const role = appRole?.role ?? profile.role

  if (role === 'admin' || role === 'super_admin') return true

  // Per-user custom override (from user_profiles) takes precedence over role.
  const custom = profile.custom_permissions as Record<string, boolean> | null
  if (custom && '/purchasing' in custom) return custom['/purchasing'] === true

  const { data: rolePerm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', role)
    .maybeSingle()

  const menu = (rolePerm?.menu_access ?? {}) as Record<string, boolean>
  return menu['/purchasing'] === true
}
