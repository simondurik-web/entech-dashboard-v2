"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { usePermissions } from "@/lib/use-permissions"
import { useI18n } from "@/lib/i18n"
import { LogIn } from "lucide-react"
import type { ReactNode } from "react"

export function AccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, loading, signIn } = useAuth()
  const { canAccess } = usePermissions()
  const { t } = useI18n()

  if (loading) return <>{children}</>

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
