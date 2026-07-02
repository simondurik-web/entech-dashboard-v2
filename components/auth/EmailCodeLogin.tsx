"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { Mail, KeyRound } from "lucide-react"

// Two-step passwordless LOGIN CODE (email → 8-digit code). Replaces the magic
// link so it works from corporate Outlook inboxes (Safe Links pre-scans and burns
// one-time links) and doesn't depend on opening the email in the same browser.
// Shared by the login page (dark card) and AccessGuard (themed card) — pass
// `dark` to match the surrounding surface. Verifies client-side, so the session
// lands in localStorage and the app's existing auth listener + default-deny
// visitor provisioning take over.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
type Phase = "email" | "sending" | "code" | "verifying"

export function EmailCodeLogin({ dark = false, redirectTo = "/orders" }: { dark?: boolean; redirectTo?: string }) {
  const { startEmailCode, verifyEmailCode } = useAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [phase, setPhase] = useState<Phase>("email")
  const [error, setError] = useState("")

  // Full, static class strings per variant so Tailwind's JIT always emits them
  // (no dynamically-assembled `hover:${...}`/`placeholder:${...}` fragments).
  const textCls = dark ? "text-white" : "text-foreground"
  const mutedCls = dark ? "text-white/50" : "text-muted-foreground"
  const placeholderCls = dark ? "placeholder:text-white/40" : "placeholder:text-muted-foreground"
  const diffHoverCls = dark ? "hover:text-white/70" : "hover:text-foreground"
  const inputCls = `w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm ${textCls} ${placeholderCls} focus:border-blue-500/60 focus:outline-none`
  const btnCls = `flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium ${dark ? "text-white/90" : "text-foreground"} transition-colors hover:bg-white/10 disabled:opacity-60`

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    const addr = email.trim()
    if (!EMAIL_RE.test(addr)) {
      setError(t("login.emailError"))
      return
    }
    setPhase("sending")
    setError("")
    const err = await startEmailCode(addr)
    if (err) {
      setPhase("email")
      setError(err)
    } else {
      setCode("")
      setPhase("code")
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    const token = code.replace(/\s+/g, "")
    if (!/^\d{4,10}$/.test(token)) {
      setError(t("login.enterCode"))
      return
    }
    setPhase("verifying")
    setError("")
    const err = await verifyEmailCode(email.trim(), token)
    if (err) {
      setPhase("code")
      setError(t("login.codeInvalid"))
    } else {
      // Full reload so AuthProvider boots with the fresh localStorage session.
      window.location.href = redirectTo
    }
  }

  if (phase === "code" || phase === "verifying") {
    return (
      <form onSubmit={verify} className="space-y-2 text-left">
        <p className={`text-center text-xs ${mutedCls}`}>
          {t("login.codeSentPrefix")} <span className={textCls}>{email.trim()}</span>
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 10))
            if (error) setError("")
          }}
          placeholder={t("login.codePlaceholder")}
          autoFocus
          className={`w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-center text-lg tracking-[0.4em] ${textCls} placeholder:tracking-normal ${dark ? "placeholder:text-white/40" : "placeholder:text-muted-foreground"} focus:border-blue-500/60 focus:outline-none`}
        />
        <button type="submit" disabled={phase === "verifying"} className={btnCls}>
          <KeyRound className="size-4" />
          {phase === "verifying" ? t("login.verifying") : t("login.verifyBtn")}
        </button>
        {error && <p className="text-xs text-red-300 text-center">{error}</p>}
        <button
          type="button"
          onClick={() => {
            setPhase("email")
            setError("")
            setCode("")
          }}
          className={`w-full pt-1 text-center text-xs ${mutedCls} ${diffHoverCls}`}
        >
          {t("login.differentEmail")}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={sendCode} className="space-y-2 text-left">
      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          if (error) setError("")
        }}
        placeholder={t("login.emailPlaceholder")}
        autoComplete="email"
        className={inputCls}
      />
      <button type="submit" disabled={phase === "sending"} className={btnCls}>
        <Mail className="size-4" />
        {phase === "sending" ? t("login.sendingCode") : t("login.codeSendBtn")}
      </button>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </form>
  )
}
