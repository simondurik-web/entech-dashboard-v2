import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Server-side replica of usePermissions().canAccess('/purchasing').
 * Write endpoints must enforce this — the page's AccessGuard is client-side
 * only and the x-user-id header is client-supplied, so the API cannot trust
 * the UI gate alone.
 */
export async function canAccessPurchasing(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, custom_permissions, is_active')
    .eq('id', userId)
    .single()

  if (!profile || profile.is_active === false) return false
  if (profile.role === 'admin' || profile.role === 'super_admin') return true

  const custom = profile.custom_permissions as Record<string, boolean> | null
  if (custom && '/purchasing' in custom) return custom['/purchasing'] === true

  const { data: rolePerm } = await supabaseAdmin
    .from('role_permissions')
    .select('menu_access')
    .eq('role', profile.role)
    .single()

  const menu = (rolePerm?.menu_access ?? {}) as Record<string, boolean>
  return menu['/purchasing'] === true
}
