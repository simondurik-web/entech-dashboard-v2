import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireUser } from "@/lib/require-user"

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const DASHBOARD_APP_ID = "dashboard"
/** The production app's role rows live in the shared `users` table (NOT
 *  user_profiles / user_app_roles) discriminated by app='production'. */
export const PRODUCTION_APP = "production"

export type PalletActor = {
  userId: string
  name: string | null
  email: string | null
  /** Row from users(app='production'), if any. */
  productionRole: "admin" | "user" | null
  productionStatus: "active" | "pending" | "disabled" | null
  /** Active production user OR molding admin — may use the Pallet Records section. */
  canView: boolean
  /** Production admin OR molding admin — bulk edits, deletes, restores, users, notify. */
  isAdmin: boolean
}

const DENIED: PalletActor = {
  userId: "", name: null, email: null,
  productionRole: null, productionStatus: null,
  canView: false, isAdmin: false,
}

/**
 * Server-side access resolver for the Pallet Records section — the replacement
 * for the source app's client-trusted `is_admin` flags (its APIs were
 * effectively unauthenticated). Every /api/pallet-records/* route MUST gate on
 * this; never trust role/admin flags from the request body or query string.
 *
 * Mirrors the standalone app's model exactly: users(app='production') with
 * role admin|user and status active|pending|disabled, plus the molding
 * dashboard's admin/super-admin override.
 */
export async function resolvePalletActor(userId: string | null | undefined): Promise<PalletActor> {
  if (!userId) return DENIED

  const [{ data: profile }, { data: appRole }, { data: prodUser }] = await Promise.all([
    supabaseAdmin.from("user_profiles").select("email, full_name, role, is_active").eq("id", userId).single(),
    supabaseAdmin.from("user_app_roles").select("role").eq("user_id", userId).eq("app_id", DASHBOARD_APP_ID).maybeSingle(),
    supabaseAdmin.from("users").select("name, email, role, status").eq("id", userId).eq("app", PRODUCTION_APP).maybeSingle(),
  ])

  // No dashboard profile is fine — production-only users may have never opened
  // the dashboard before; their auth uuid still identifies them.
  if (profile && profile.is_active === false) return DENIED

  const email = (profile?.email ?? prodUser?.email ?? null) as string | null
  const isSuper = email?.toLowerCase() === SUPER_ADMIN_EMAIL
  const dashboardRole = appRole?.role ?? null
  // A blocked molding user is locked out of Pallet Records too.
  if (dashboardRole === "blocked") return DENIED
  const moldingAdmin = dashboardRole === "admin" || dashboardRole === "super_admin" || isSuper

  const productionRole = (prodUser?.role === "admin" || prodUser?.role === "user") ? prodUser.role : null
  const productionStatus = (prodUser?.status === "active" || prodUser?.status === "pending" || prodUser?.status === "disabled")
    ? prodUser.status : null

  const activeProduction = productionStatus === "active"
  const canView = moldingAdmin || activeProduction
  const isAdmin = moldingAdmin || (activeProduction && productionRole === "admin")

  return {
    userId,
    name: (profile?.full_name ?? prodUser?.name ?? null) as string | null,
    email,
    productionRole,
    productionStatus,
    canView,
    isAdmin,
  }
}

/**
 * Resolve the caller from the VERIFIED Supabase Bearer token, then apply the
 * Pallet Records access model above.
 *
 * Hardened 2026-07-27. This used to read `req.headers.get("x-user-id")` — a
 * value the caller writes themselves — so presenting any known user UUID was
 * enough to be that user. Verified against production before the fix:
 * `curl -H 'x-user-id: <uuid>' https://dashboard.4molding.com/api/pallet-records/users`
 * returned the admin-only user list (200). The rest of the dashboard moved off
 * this pattern on 2026-06-25; Pallet Records and Quality were missed because
 * both were ported in from standalone apps.
 *
 * Floor devices have no Supabase session and so resolve to DENIED — which is
 * the behavior they already had (a device id has no user_profiles row), so this
 * is not a regression for them.
 */
export async function palletActorFromRequest(req: Request): Promise<PalletActor> {
  const user = await requireUser(req)
  return resolvePalletActor(user?.id)
}
