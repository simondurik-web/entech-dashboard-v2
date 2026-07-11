"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n"
import { LogIn, MonitorSmartphone, Clock, CheckCircle2 } from "lucide-react"
import Link from "next/link"
import { EmailCodeLogin } from "@/components/auth/EmailCodeLogin"
import {
  getDeviceToken,
  getOrCreateDeviceToken,
  checkDeviceStatus,
} from "@/lib/device-auth"

type DeviceUiState =
  | { phase: "idle" }
  | { phase: "pending"; code: string }
  | { phase: "approved" }
  | { phase: "error" }

const POLL_MS = 5000

export default function LoginPage() {
  const { signIn } = useAuth()
  const { t } = useI18n()
  const [device, setDevice] = useState<DeviceUiState>({ phase: "idle" })
  const pollRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback((token: string) => {
    stopPolling()
    pollRef.current = window.setInterval(async () => {
      const status = await checkDeviceStatus(token)
      if (status?.status === "approved") {
        stopPolling()
        setDevice({ phase: "approved" })
        // Full reload so AuthProvider boots into the device session.
        window.location.href = "/orders"
      }
    }, POLL_MS)
  }, [stopPolling])

  // A device that already requested access resumes the waiting screen on
  // reload (or unlocks immediately if it was approved meanwhile).
  useEffect(() => {
    const token = getDeviceToken()
    if (!token) return
    let cancelled = false
    checkDeviceStatus(token).then((status) => {
      if (cancelled || !status) return
      if (status.status === "approved") {
        setDevice({ phase: "approved" })
        window.location.href = "/orders"
      } else if (status.status === "pending") {
        setDevice({ phase: "pending", code: "" })
        // Re-request is idempotent and returns the pairing code.
        requestAccess(token)
      }
    })
    return () => {
      cancelled = true
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function requestAccess(existingToken?: string) {
    const token = existingToken ?? getOrCreateDeviceToken()
    if (!token) {
      setDevice({ phase: "error" })
      return
    }
    try {
      const res = await fetch("/api/devices/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) throw new Error("request failed")
      const data = await res.json()
      if (data.status === "approved") {
        setDevice({ phase: "approved" })
        window.location.href = "/orders"
        return
      }
      setDevice({ phase: "pending", code: data.code ?? "" })
      startPolling(token)
    } catch {
      setDevice({ phase: "error" })
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0e1a]">
      {/* Aurora Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-md">
        <h1 className="mb-1 text-2xl font-bold text-white">Entech Dashboard</h1>
        <p className="mb-8 text-sm text-white/60">Molding Operations</p>

        <button
          onClick={() => signIn()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <LogIn className="size-4" />
          Sign in with Google
        </button>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs uppercase tracking-wider text-white/40">
            {t("login.or")}
          </span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        {/* Passwordless email LOGIN CODE — corporate-inbox-safe (typed code, not a
            one-time link Safe Links can burn). Works for any email address. */}
        <EmailCodeLogin dark redirectTo="/orders" />

        <Link
          href="/orders"
          className="mt-5 inline-block text-sm text-white/50 hover:text-white/80"
        >
          Continue as visitor →
        </Link>

        <div className="mt-6 border-t border-white/10 pt-5">
          {device.phase === "idle" && (
            <button
              onClick={() => requestAccess()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/10"
            >
              <MonitorSmartphone className="size-4" />
              {t("device.requestAccess")}
            </button>
          )}

          {device.phase === "pending" && (
            <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
                <Clock className="size-4 shrink-0" />
                {t("device.waitingApproval")}
              </div>
              {device.code && (
                <p className="mt-2 text-sm text-white/70">
                  {t("device.pairingCode")}{" "}
                  <span className="font-mono text-lg font-bold tracking-widest text-white">
                    {device.code}
                  </span>
                </p>
              )}
              <p className="mt-1 text-xs text-white/50">{t("device.waitingHint")}</p>
            </div>
          )}

          {device.phase === "approved" && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-300">
              <CheckCircle2 className="size-4" />
              {t("device.approvedRedirect")}
            </div>
          )}

          {device.phase === "error" && (
            <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
              {t("device.requestError")}
              <button
                onClick={() => requestAccess()}
                className="ml-2 underline hover:text-red-200"
              >
                {t("device.retry")}
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .aurora-blob {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.4;
          mix-blend-mode: screen;
        }
        .aurora-blob-1 {
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, #1e3a5f, #0d1b2a);
          top: -10%;
          left: -10%;
          animation: aurora-drift-1 12s ease-in-out infinite alternate;
        }
        .aurora-blob-2 {
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, #6b21a8, #1e1b4b);
          bottom: -5%;
          right: -5%;
          animation: aurora-drift-2 10s ease-in-out infinite alternate;
        }
        .aurora-blob-3 {
          width: 350px;
          height: 350px;
          background: radial-gradient(circle, #0d9488, #064e3b);
          top: 40%;
          left: 50%;
          animation: aurora-drift-3 14s ease-in-out infinite alternate;
        }
        @keyframes aurora-drift-1 {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(80px, 60px) scale(1.2); }
        }
        @keyframes aurora-drift-2 {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-60px, -40px) scale(1.15); }
        }
        @keyframes aurora-drift-3 {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-40px, 50px) scale(1.1); }
        }
      `}</style>
    </div>
  )
}
