import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Per-user printer ACL (default-allow). A user may print to every enabled
 * `print_stations` row UNLESS a `user_printer_access` row marks that station
 * `allowed=false`. Admins / super-admins bypass entirely (always all printers).
 * Managed from Admin > Printer Access. Enforced server-side in the printer
 * dropdown (`/api/erpnext/print-stations`) AND every label route, so a blocked
 * printer can't be reached by hand-crafting a request — not just hidden in the UI.
 */
export function isPrinterAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin'
}

/** Station ids explicitly denied to this user (allowed=false). Admins → empty. */
export async function deniedStationIds(
  userId: string,
  role?: string | null
): Promise<Set<string>> {
  if (isPrinterAdminRole(role)) return new Set()
  const { data, error } = await supabaseAdmin
    .from('user_printer_access')
    .select('station_id')
    .eq('user_id', userId)
    .eq('allowed', false)
  if (error) {
    // Fail OPEN to the default-allow posture rather than block all printing on a
    // read error — the ACL is a restriction layer, not the primary access gate.
    console.error('deniedStationIds lookup failed:', error)
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

/** True if the user may print to a specific station (default-allow; admins always). */
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
    console.error('userCanPrintTo lookup failed:', error)
    return true // fail open to default-allow
  }
  return data?.allowed !== false
}
