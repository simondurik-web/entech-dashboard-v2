import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Per-user printer ACL (default-DENY). A user may print to an enabled
 * `print_stations` row ONLY when a `user_printer_access` row grants it
 * (`allowed=true`). No row → no access. Admins / super-admins bypass entirely
 * (always all printers). Managed from Admin > Printer Access.
 * Enforced server-side in the printer dropdown (`/api/erpnext/print-stations`)
 * AND every label route, so a printer can't be reached by hand-crafting a
 * request — not just hidden in the UI.
 *
 * Default-deny means new users and newly-added printers start with ZERO access;
 * an admin must explicitly grant each (user, station) pair.
 */
export function isPrinterAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin'
}

/**
 * Station ids this user is explicitly granted (`allowed=true`).
 * Returns `'all'` for admins (they bypass the ACL). On a read error, fails
 * CLOSED (empty set / no access) to honour the default-deny posture.
 */
export async function allowedStationIds(
  userId: string,
  role?: string | null
): Promise<Set<string> | 'all'> {
  if (isPrinterAdminRole(role)) return 'all'
  const { data, error } = await supabaseAdmin
    .from('user_printer_access')
    .select('station_id')
    .eq('user_id', userId)
    .eq('allowed', true)
  if (error) {
    // Fail CLOSED: deny everything rather than risk granting on a read error.
    console.error('allowedStationIds lookup failed:', error)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.station_id as string))
}

/** The user's chosen default print station id, or null if none set. */
export async function defaultStationForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('user_default_printer')
    .select('station_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('defaultStationForUser lookup failed:', error)
    return null
  }
  return data?.station_id ?? null
}

/** True if the user may print to a specific station (default-DENY; admins always). */
export async function userCanPrintTo(
  userId: string,
  role: string | null | undefined,
  stationId: string
): Promise<boolean> {
  if (isPrinterAdminRole(role)) return true
  const { data, error } = await supabaseAdmin
    .from('user_printer_access')
    .select('allowed')
    .eq('user_id', userId)
    .eq('station_id', stationId)
    .maybeSingle()
  if (error) {
    // Fail CLOSED: deny on a read error to honour the default-deny posture.
    console.error('userCanPrintTo lookup failed:', error)
    return false
  }
  return data?.allowed === true
}
