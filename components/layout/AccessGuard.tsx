"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { usePermissions } from "@/lib/use-permissions"
import { useQualityAccess } from "@/lib/use-quality-access"
import { usePalletAccess } from "@/lib/use-pallet-access"
import { useI18n } from "@/lib/i18n"
import { LogIn } from "lucide-react"
import type { ReactNode } from "react"

export function AccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, loading, signIn } = useAuth()
  const { canAccess } = usePermissions()
  const { canSeeQuality, canManageQuality, canEditLimits } = useQualityAccess()
  const { canSeePallets, isPalletAdmin } = usePalletAccess()
  const { t } = useI18n()

  const accessDenied = (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold">{t('auth.accessDenied')}</h2>
        <p className="mb-4 text-muted-foreground">
          {t('auth.accessDeniedMessage')}
        </p>
        {!user && (
          <button
            onClick={signIn}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <LogIn className="size-4" />
            {t('ui.signIn')}
          </button>
        )}
      </div>
    </div>
  )

  if (loading) return <>{children}</>

  // Quality (EQDR) section — gated by the user's Quality role (user_app_roles[quality]),
  // NOT the molding menu permissions, so the same QA users keep their existing access.
  // Admin-only sub-pages (Products/Users/Audit) and the Limits editor mirror EQDR's rules.
  // Exact-or-child matching avoids matching unrelated paths like "/quality-old".
  const inPath = (base: string) => pathname === base || pathname.startsWith(base + "/")
  if (inPath("/quality")) {
    const isQaAdminPath =
      inPath("/quality/products") || inPath("/quality/users") || inPath("/quality/audit")
    const isLimitsPath = inPath("/quality/limits")
    const allowed = isQaAdminPath
      ? canManageQuality
      : isLimitsPath
        ? canEditLimits
        : canSeeQuality
    return allowed ? <>{children}</> : accessDenied
  }

  // Pallet Records (ported pallet-registration app) — gated by membership in
  // the shared users(app='production') table, NOT menu permissions. This MUST
  // intercept before the generic canAccess check: legacy role_permissions still
  // grant the '/pallet-records' path (it used to be the Sheets photo page, now
  // at /pallet-photos) and must not leak the new section to non-members.
  if (inPath("/pallet-records")) {
    const allowed = inPath("/pallet-records/admin") ? isPalletAdmin : canSeePallets
    return allowed ? <>{children}</> : accessDenied
  }

  // Admin paths need admin role
  if (pathname.startsWith("/admin")) {
    if (!canAccess(pathname)) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
            <h2 className="mb-2 text-xl font-semibold">{t('admin.accessRequired')}</h2>
            <p className="mb-4 text-muted-foreground">
              {t('admin.accessMessage')}
            </p>
          </div>
        </div>
      )
    }
  }

  // Check regular page access
  if (!canAccess(pathname)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold">{t('auth.accessDenied')}</h2>
          <p className="mb-4 text-muted-foreground">
            {t('auth.accessDeniedMessage')}
          </p>
          {!user && (
            <button
              onClick={signIn}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn className="size-4" />
              {t('ui.signIn')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
