"use client"

import { useMemo } from "react"
import { useAuth, isSuperAdmin } from "./auth-context"
import { usePermissions } from "./use-permissions"

/**
 * Access logic for the integrated Quality (EODR) section.
 *
 * Source of truth for who can do what mirrors the standalone EQDR app exactly:
 * each person's Quality role lives in `user_app_roles[quality]` and is surfaced
 * on the profile as `quality_role`. This means every existing QA user keeps the
 * access they have today — no re-assignment.
 *
 * Access is granted if EITHER:
 *  - the user has a non-visitor Quality role (the EQDR users), OR
 *  - the molding dashboard grants `/quality` via role_permissions / admin, OR
 *  - the user is a molding admin / super admin.
 *
 * In-section admin gating (Products / Users / Audit / Limits) follows the same
 * rules the standalone app used.
 */
export function useQualityAccess() {
  const { profile } = useAuth()
  const { canAccess } = usePermissions()

  return useMemo(() => {
    const qRole = profile?.quality_role ?? null
    const email = profile?.email ?? null
    const moldingAdmin =
      profile?.role === "admin" || profile?.role === "super_admin" || isSuperAdmin(email)

    // Did the molding side explicitly grant /quality to this user's role?
    const grantedByDashboard = canAccess("/quality")

    const hasQualityRole = !!qRole && qRole !== "visitor"

    const isQualityAdmin = moldingAdmin || qRole === "admin"
    const isQualityManager =
      isQualityAdmin || qRole === "manager" || qRole === "qa_manager"

    // Whether to show the Quality section at all.
    const canSeeQuality = moldingAdmin || hasQualityRole || grantedByDashboard

    return {
      qualityRole: qRole,
      canSeeQuality,
      isQualityAdmin,
      // Limits editing matched EQDR: admin, manager/qa_manager, or super admin.
      canEditLimits: isQualityManager || isSuperAdmin(email),
      // Products / Users / Audit were admin-only in EQDR.
      canManageQuality: isQualityAdmin,
    }
  }, [profile, canAccess])
}
