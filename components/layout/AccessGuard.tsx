"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { usePermissions } from "@/lib/use-permissions"
import { useQualityAccess } from "@/lib/use-quality-access"
import { usePalletAccess } from "@/lib/use-pallet-access"
import { useI18n } from "@/lib/i18n"
import { LogIn, MonitorSmartphone, Mail, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { useState, type ReactNode } from "react"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type EmailUiState = "idle" | "sending" | "sent" | "error"

export function AccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, loading, signIn, signInWithEmail, signOut, profile } = useAuth()
  const { canAccess } = usePermissions()
  const { canSeeQuality, canManageQuality, canEditLimits } = useQualityAccess()
  const { canSeePallets, isPalletAdmin } = usePalletAccess()
  const { t } = useI18n()
  const [email, setEmail] = useState("")
  const [emailState, setEmailState] = useState<EmailUiState>("idle")

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    const addr = email.trim()
    if (!EMAIL_RE.test(addr)) {
      setEmailState("error")
      return
    }
    setEmailState("sending")
    const err = await signInWithEmail(addr)
    setEmailState(err ? "error" : "sent")
  }

  const accessDenied = (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold">{t('auth.accessDenied')}</h2>
        <p className="mb-4 text-muted-foreground">
          {t('auth.accessDeniedMessage')}
        </p>
        {!user && (
          <>
            <button
              onClick={signIn}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn className="size-4" />
              {t('ui.signIn')}
            </button>

            {/* Divider */}
            <div className="my-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('login.or')}
              </span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            {/* Passwordless email magic link — works for any email address */}
            {emailState === "sent" ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm font-medium text-emerald-300">
                <CheckCircle2 className="size-4 shrink-0" />
                {t('login.magicLinkSent')}
              </div>
            ) : (
              <form onSubmit={submitEmail} className="space-y-2 text-left">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    if (emailState === "error") setEmailState("idle")
                  }}
                  placeholder={t('login.emailPlaceholder')}
                  autoComplete="email"
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={emailState === "sending"}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  <Mail className="size-4" />
                  {emailState === "sending" ? t('login.sending') : t('login.emailLink')}
                </button>
                {emailState === "error" && (
                  <p className="text-xs text-red-300">{t('login.emailError')}</p>
                )}
              </form>
            )}

            <Link
              href="/login"
              className="mt-3 flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <MonitorSmartphone className="size-4" />
              {t('device.sharedComputerLink')}
            </Link>
          </>
        )}
      </div>
    </div>
  )

  if (loading) return <>{children}</>

  // Blocked users are hard-denied everywhere — not even the visitor view.
  if (user && profile?.role === "blocked") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold">{t('auth.blocked')}</h2>
          <p className="mb-4 text-muted-foreground">{t('auth.blockedMessage')}</p>
          <button
            onClick={signOut}
            className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
          >
            {t('auth.signOut')}
          </button>
        </div>
      </div>
    )
  }

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
    return accessDenied
  }

  return <>{children}</>
}
