import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser, requirePermissionOrDevice, loadDashboardProfile } from '@/lib/require-user'

const DASHBOARD_APP_ID = 'dashboard'

/** Resolve the user profile from the verified Supabase Bearer token, with the
 *  app-specific role overlay. (Hardened 2026-06-25: was the spoofable x-user-id
 *  header.) The function name is kept for its many call sites. */
export async function getProfileFromHeader(req: NextRequest) {
  const userId = (await requireUser(req))?.id
  if (!userId) return null

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, role')
    .eq('id', userId)
    .single()

  // No is_active check here: requireUser (above) already refused a deactivated
  // caller. One authority for deactivation, not two that can drift.
  if (!profile) return null

  // Overlay app-specific role
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', DASHBOARD_APP_ID)
    .single()

  // Access requires an explicit dashboard app-role; no enrollment -> visitor
  // (matches overlayAppRole + the other guards; also lets 'blocked' deny).
  return { ...profile, role: appRole?.role ?? 'visitor' }
}

/** The caller for a scheduling READ, resolved through the app's own permission
 *  matrix rather than a hand-written role list.
 *
 *  First version of this only denied 'visitor'/'blocked', which quietly ignored
 *  the configurable `/scheduling` permission and any per-user override — a
 *  manager explicitly denied scheduling could still pull the roster and the pay
 *  rates (codex, review panel round 3). requirePermissionOrDevice is the
 *  existing helper for exactly this, and it already understands approved floor
 *  devices, so tablets keep working without a second code path.
 *
 *  `/scheduling` is currently true for every non-visitor role, so this changes
 *  nothing today — it means the matrix is obeyed if Simon ever changes it. */
export async function getSchedulingViewer(
  req: NextRequest,
): Promise<{ role: string; kind: "user" | "device" } | null> {
  const actor = await requirePermissionOrDevice(req, '/scheduling')
  if (!actor) return null
  // Devices carry their own role; a device with none falls to 'visitor', which
  // is deny-on-missing (safe direction). All 8 approved devices have a real
  // role as of 2026-07-27.
  if (actor.kind === "device") return { role: actor.role ?? "visitor", kind: "device" }
  // requirePermission returns the user without a role, and the pay-rate strip
  // below needs one, so resolve it once here.
  const p = await loadDashboardProfile(actor.id)
  return { role: p.role, kind: "user" }
}

export function canEditScheduling(role: string) {
  return ['admin', 'super_admin', 'manager', 'group_leader'].includes(role)
}

/** Payroll visibility. Takes the whole viewer, not just the role, because a
 *  SHARED FLOOR DEVICE can be enrolled as 'manager' (one is — "Tesla") and a
 *  role-only check would have printed every employee's pay rate onto a tablet
 *  sitting on the shop floor. Caught by codex in the 2026-07-27 review panel;
 *  it was introduced by this change, not pre-existing. Wages are for a person
 *  who logged in, never for a device. */
export function canSeePayRate(viewer: { role: string; kind: "user" | "device" }) {
  if (viewer.kind !== "user") return false
  return ['admin', 'super_admin', 'manager'].includes(viewer.role)
}

/** Schedule change history. Same reasoning as canSeePayRate: this is
 *  manager-only material and the Audit Log tab only renders for a logged-in
 *  admin/manager, so a shared floor device must not be able to pull it from the
 *  API either — even one enrolled with a manager role. */
export function canViewHistory(viewer: { role: string; kind: "user" | "device" }) {
  if (viewer.kind !== "user") return false
  return ['admin', 'super_admin', 'manager', 'group_leader'].includes(viewer.role)
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** Returns today's date in YYYY-MM-DD for America/Indiana/Indianapolis */
export function getIndianapolisTodayIso(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Indiana/Indianapolis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}

/** Normalize date input to YYYY-MM-DD */
export function normalizeDateInput(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const d = new Date(date)
  if (isNaN(d.getTime())) return date
  return d.toISOString().split('T')[0]
}
