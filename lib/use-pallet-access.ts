"use client"

import { useMemo } from "react"
import { useAuth, isSuperAdmin } from "./auth-context"

/**
 * Client access logic for the integrated Pallet Records section.
 *
 * Mirrors the standalone pallet-registration app exactly: membership lives in
 * the shared `users` table (app='production', surfaced on the profile as
 * `production_access`). Active members can use the section; production admins
 * (or molding admins / super admin) get the Admin tab and admin-only actions.
 *
 * Server-side twin: lib/pallets/guard.ts resolvePalletActor — keep in sync.
 */
export function usePalletAccess() {
  const { user, profile } = useAuth()

  return useMemo(() => {
    const email = profile?.email ?? null
    const moldingAdmin =
      profile?.role === "admin" || profile?.role === "super_admin" || isSuperAdmin(email)

    const prod = profile?.production_access ?? null
    const activeProduction = !!user && prod?.status === "active"

    const canSeePallets = moldingAdmin || activeProduction
    const isPalletAdmin = moldingAdmin || (activeProduction && prod?.role === "admin")

    return {
      productionRole: prod?.role ?? null,
      productionStatus: prod?.status ?? null,
      canSeePallets,
      isPalletAdmin,
    }
  }, [user, profile])
}
