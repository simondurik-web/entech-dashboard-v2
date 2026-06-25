import { supabaseAdmin } from "@/lib/supabase-admin"

const DASHBOARD_APP_ID = "dashboard"
const QUALITY_APP_ID = "quality"
const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"

export type QualityActor = {
  userId: string
  name: string | null
  email: string | null
  /** Effective dashboard role (user_app_roles[dashboard] overlaid on profile.role). */
  dashboardRole: string
  /** Quality-app role (user_app_roles[quality]) or null. */
  qualityRole: string | null
  /** Has a non-visitor Quality role OR is a molding admin — may view/enter QA data. */
  canView: boolean
  /** QA admin (Products / Users / Audit, edit any inspection). */
  canManage: boolean
  /** May edit spec limits (QA admin / manager / qa_manager / super admin). */
  canEditLimits: boolean
}

const DENIED: QualityActor = {
  userId: "", name: null, email: null, dashboardRole: "visitor", qualityRole: null,
  canView: false, canManage: false, canEditLimits: false,
}

/**
 * Server-side replica of useQualityAccess (lib/use-quality-access.ts). Every
 * /api/quality/* write route MUST call this — the page AccessGuard is client-side
 * only and the x-user-id header is client-supplied, so the API can't trust the UI.
 *
 * Access mirrors the standalone EQDR app: a user's Quality role lives in
 * user_app_roles[quality]; molding admins/super-admin also get full access.
 */
export async function resolveQualityActor(
  userId: string | null | undefined,
): Promise<QualityActor> {
  if (!userId) return DENIED

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email, full_name, role, is_active")
    .eq("id", userId)
    .single()
  if (!profile || profile.is_active === false) return DENIED

  const { data: appRoles } = await supabaseAdmin
    .from("user_app_roles")
    .select("app_id, role")
    .eq("user_id", userId)
    .in("app_id", [DASHBOARD_APP_ID, QUALITY_APP_ID])

  const dashboardRole = appRoles?.find((r) => r.app_id === DASHBOARD_APP_ID)?.role ?? "visitor"
  // A blocked molding user is locked out of the Quality subsystem too.
  if (dashboardRole === "blocked") return DENIED
  const qualityRole = appRoles?.find((r) => r.app_id === QUALITY_APP_ID)?.role ?? null
  const email = profile.email ?? null
  const isSuper = email?.toLowerCase() === SUPER_ADMIN_EMAIL
  const moldingAdmin = dashboardRole === "admin" || dashboardRole === "super_admin" || isSuper

  // Mirror the client useQualityAccess "grantedByDashboard" path: a signed-in,
  // non-visitor dashboard role that the molding admin granted /quality via
  // role_permissions can also view/enter QA data. Without this the server would
  // 403 a user the client UI lets in.
  let grantedByDashboard = false
  if (!moldingAdmin && dashboardRole !== "visitor") {
    const { data: rolePerm } = await supabaseAdmin
      .from("role_permissions")
      .select("menu_access")
      .eq("role", dashboardRole)
      .maybeSingle()
    const menu = (rolePerm?.menu_access ?? {}) as Record<string, boolean>
    grantedByDashboard = menu["/quality"] === true
  }

  const canManage = moldingAdmin || qualityRole === "admin"
  const canEditLimits = canManage || qualityRole === "manager" || qualityRole === "qa_manager"
  const canView = moldingAdmin || (!!qualityRole && qualityRole !== "visitor") || grantedByDashboard

  return {
    userId,
    name: profile.full_name ?? null,
    email,
    dashboardRole,
    qualityRole,
    canView,
    canManage,
    canEditLimits,
  }
}

/** Pull the x-user-id header and resolve the actor in one step. */
export async function qualityActorFromRequest(req: Request): Promise<QualityActor> {
  const userId = req.headers.get("x-user-id")
  return resolveQualityActor(userId)
}
