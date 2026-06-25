import { supabaseAdmin } from '@/lib/supabase-admin'

const DASHBOARD_APP_ID = 'dashboard'
// Mirror of lib/auth-context's super-admin invariant ("cannot be demoted by
// anyone"). Inlined rather than imported because auth-context is a 'use client'
// module and this guard runs server-side in the API route.
const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'

/**
 * Server-side replica of usePermissions().canAccess('/po-automation').
 * The /api/po-automation route reads po_automation.processed_pos via the
 * service-role client (bypasses RLS), so it must enforce this itself — the
 * page's AccessGuard and the OrderDetail canAccess() gate are client-side only.
 *
 * IMPORTANT: the effective dashboard role is the user's user_app_roles entry
 * for the "dashboard" app overlaid on user_profiles.role — exactly what
 * /api/auth/profile and lib/purchasing/guard.ts do. Reading user_profiles.role
 * alone wrongly denies managers assigned via user_app_roles.
 */
export async function canAccessPoAutomation(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('email, role, custom_permissions, is_active')
    .eq('id', userId)
    .single()

  if (!profile || profile.is_active === false) return false

  // Super-admin always has access, regardless of DB role (the email is forced to
  // 'admin' client-side but the stored role may differ — don't lock them out).
  if (profile.email?.toLowerCase() === SUPER_ADMIN_EMAIL) return true

  // Overlay the dashboard app-role over the global profile role (mirrors /api/auth/profile).
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', DASHBOARD_APP_ID)
    .maybeSingle()
  const role = appRole?.role ?? 'visitor'

  // Blocked is a hard-deny — before custom_permissions can grant anything.
  if (role === 'blocked') return false

  if (role === 'admin' || role === 'super_admin') return true

  // Per-user custom override (from user_profiles) takes precedence over role.
  const custom = profile.custom_permissions as Record<string, boolean> | null
  if (custom && '/po-automation' in custom) return custom['/po-automation'] === true

  const { data: rolePerm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', role)
    .maybeSingle()

  const menu = (rolePerm?.menu_access ?? {}) as Record<string, boolean>
  return menu['/po-automation'] === true
}
