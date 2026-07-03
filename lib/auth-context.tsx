"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import { supabase } from "./supabase"
import { setDataCacheOwner, clearDataCache, prefetchHeavyData } from "./data-cache"
import { getDeviceToken, checkDeviceStatus } from "./device-auth"
import { installApiFetchInterceptor } from "./api-fetch-interceptor"
import type { User, Session } from "@supabase/supabase-js"

// Patch window.fetch to attach the session/device token to same-origin /api/
// calls. Runs at module load (client) — before AuthProvider mounts or any page
// fetches data — so every data read authenticates without per-call-site changes.
installApiFetchInterceptor()

// 'blocked' is a hard-deny state (not a permission tier): a blocked user can't
// access anything, not even the visitor view. Enforced in canAccess + AccessGuard
// + (by deny-by-default) every server guard.
export type UserRole = 'visitor' | 'regular_user' | 'advanced_user' | 'group_leader' | 'shipping_team' | 'shipping_manager' | 'manager' | 'admin' | 'blocked'

// Hardcoded super admin — cannot be demoted by anyone
export const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'
export function isSuperAdmin(email?: string | null): boolean {
  return email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()
}

export type UserProfile = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: string
  // Role in the Quality (EODR) app, overlaid from user_app_roles[quality].
  // Null when the user has no Quality-app role. Used to gate the Quality section.
  quality_role: string | null
  // Membership in the pallet-registration app (shared `users` table,
  // app='production'). Null when not enrolled. Gates the Pallet Records section.
  production_access: { role: string; status: string } | null
  custom_permissions: Record<string, boolean> | null
  is_active: boolean
}

type AuthContextType = {
  user: User | null
  profile: UserProfile | null
  loading: boolean
  signIn: () => Promise<void>
  // Passwordless email LOGIN CODE (replaces the magic link — corporate Outlook
  // Safe Links pre-scans and burns one-time links; a typed code is immune).
  // startEmailCode emails an 8-digit code via our own Resend sender; verifyEmailCode
  // checks it client-side and establishes the localStorage session. Both return an
  // error string on failure, or null on success. New external users still land as
  // `visitor` (no access) — the code only authenticates, it never grants a role.
  startEmailCode: (email: string) => Promise<string | null>
  verifyEmailCode: (email: string, token: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  startEmailCode: async () => null,
  verifyEmailCode: async () => null,
  signOut: async () => {},
})

// Device-side profile cache (Simon 2026-06-10: "caching on the device").
// Hydrates the UI with the last-known profile instantly on boot; the network
// load still runs and overwrites it, so a role change is corrected within
// ~1s of page load. Lives alongside the Supabase session (also localStorage)
// and is cleared on sign-out.
const PROFILE_CACHE_KEY = "edv2.profile.v1"

function readCachedProfile(userId: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId: string; profile: UserProfile }
    return parsed.userId === userId ? parsed.profile : null
  } catch {
    return null
  }
}

function writeCachedProfile(userId: string, profile: UserProfile | null) {
  try {
    if (profile) {
      localStorage.setItem(
        PROFILE_CACHE_KEY,
        JSON.stringify({ userId, profile }),
      )
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY)
    }
  } catch {
    // storage blocked — cache is best-effort
  }
}

function clearCachedProfile() {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY)
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  // The user id we last loaded a profile for — prevents the boot sequence
  // (getSession + the INITIAL_SESSION/SIGNED_IN auth event) from fetching the
  // profile twice on every page load. Cleared on failure so a transient
  // network error doesn't lock the tab into the visitor role forever.
  const loadedForUserRef = useRef<string | null>(null)
  const lastLoadAtRef = useRef(0)
  // True while this browser is running as an approved shared device
  // (authorized_devices) instead of a personal Google session.
  const deviceSessionRef = useRef(false)
  // Re-read the profile on TOKEN_REFRESHED at most this often, so admin role
  // grants/revocations still reach long-lived tabs without a manual reload.
  const ROLE_REFRESH_MS = 15 * 60 * 1000

  const applyProfile = useCallback((u: User, p: UserProfile | null) => {
    // Enforce super admin — always admin regardless of DB
    if (isSuperAdmin(u.email) && p) {
      p.role = 'admin'
    }
    setProfile(p)
    if (p) writeCachedProfile(u.id, p)
  }, [])

  // Write path: upserts the profile row (creates it on first-ever login or
  // claims a pre-enrolled row). Identity comes from the Bearer token
  // server-side; the body only carries cosmetic fields.
  const upsertProfile = useCallback(async (u: User, accessToken: string) => {
    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          full_name: u.user_metadata?.full_name || u.user_metadata?.name || "",
          avatar_url: u.user_metadata?.avatar_url || u.user_metadata?.picture || "",
        }),
      })
      if (res.ok) {
        const data = await res.json()
        applyProfile(u, data.profile)
        return true
      }
    } catch (err) {
      console.error("Failed to upsert profile:", err)
    }
    return false
  }, [applyProfile])

  // Read path: plain GET with the session token — no DB writes. Falls back to
  // the upsert when the profile row doesn't exist yet (first-ever login or a
  // pre-enrolled row that still has its placeholder id).
  const loadProfile = useCallback(async (u: User, accessToken: string) => {
    let applied = false
    try {
      const res = await fetch("/api/auth/profile", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.profile) {
          applyProfile(u, data.profile)
          applied = true
        }
      }
      if (!applied) {
        applied = await upsertProfile(u, accessToken)
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err)
    }
    if (applied) {
      lastLoadAtRef.current = Date.now()
    } else {
      // Let the next auth event retry instead of leaving the tab as visitor.
      loadedForUserRef.current = null
    }
  }, [applyProfile, upsertProfile])

  // Shared floor computers: no Google session, but an admin-approved device
  // token in localStorage. Builds a pseudo-profile from the device's assigned
  // role; the id is the device uuid, which no user-keyed server guard
  // matches, so device sessions are read-only by construction.
  const tryDeviceSession = useCallback(async () => {
    const token = getDeviceToken()
    if (!token) return
    const result = await checkDeviceStatus(token)
    if (result?.status === "approved" && result.device) {
      deviceSessionRef.current = true
      setDataCacheOwner(`device:${result.device.id}`)
      prefetchHeavyData()
      setProfile({
        id: result.device.id,
        email: "",
        full_name: result.device.name,
        avatar_url: null,
        role: result.device.role,
        quality_role: null,
        production_access: null,
        custom_permissions: null,
        is_active: true,
      })
    } else {
      // Pending, revoked, deleted, or not yet registered — no session, but
      // KEEP the token: "unknown" can be a registration still in flight
      // (clearing here raced the login page's request POST and orphaned the
      // pairing), and a revoked device must unlock again on re-approval
      // without a re-pairing.
      deviceSessionRef.current = false
    }
  }, [])

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        // Wipes the table cache if it belongs to a different user before
        // any page can paint it, then warms the heavy endpoints.
        setDataCacheOwner(session.user.id)
        prefetchHeavyData()
        if (loadedForUserRef.current !== session.user.id) {
          loadedForUserRef.current = session.user.id
          // Paint with the device-cached profile immediately; the network
          // load below revalidates and overwrites it.
          const cached = readCachedProfile(session.user.id)
          if (cached) applyProfile(session.user, cached)
          loadProfile(session.user, session.access_token)
        }
      } else {
        await tryDeviceSession()
      }
      setLoading(false)
    })

    // Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user)
          // A personal Google session always outranks device mode.
          deviceSessionRef.current = false
          setDataCacheOwner(session.user.id)
          const isNewUser = loadedForUserRef.current !== session.user.id
          // TOKEN_REFRESHED fires ~hourly; use it as a cheap opportunity to
          // pick up role changes, throttled by ROLE_REFRESH_MS.
          const isStaleRefresh =
            event === "TOKEN_REFRESHED" &&
            Date.now() - lastLoadAtRef.current > ROLE_REFRESH_MS
          if (isNewUser || isStaleRefresh) {
            loadedForUserRef.current = session.user.id
            await loadProfile(session.user, session.access_token)
          }
        } else if (!deviceSessionRef.current) {
          // INITIAL_SESSION fires with a null session on every logged-out
          // boot — only a real sign-out clears the device's table cache,
          // and an active device session is never clobbered.
          setUser(null)
          setProfile(null)
          loadedForUserRef.current = null
          clearCachedProfile()
          if (event === "SIGNED_OUT") {
            // Shared-computer hygiene: signed out = no cached tables left
            // behind. An approved device then falls back to device mode.
            void clearDataCache().then(() => tryDeviceSession())
          }
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [loadProfile, applyProfile, tryDeviceSession])

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? window.location.origin + "/orders" : undefined,
      },
    })
  }

  // Step 1 — email an 8-digit login code. Our /start route asks Supabase to
  // GENERATE (not send) the OTP and delivers it via our own Resend sender
  // ("Molding Dashboard Login"), so the shared Supabase mailer + its template are
  // untouched and corporate Safe Links can't burn a link. Returns an error string
  // or null.
  const startEmailCode = async (email: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/auth/otp/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return data?.error || "Could not send the code. Try again."
      }
      return null
    } catch {
      return "Could not send the code. Try again."
    }
  }

  // Step 2 — verify the code CLIENT-side. This app stores its session in
  // localStorage (no cookies/SSR), so verifyOtp here drops the real session into
  // localStorage and fires onAuthStateChange(SIGNED_IN), which runs the existing
  // profile funnel (/api/auth/profile) — new external users default to `visitor`
  // (no access), same default-deny gate as Google sign-in. Returns an error
  // string or null.
  const verifyEmailCode = async (email: string, token: string): Promise<string | null> => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim().replace(/\s+/g, ""),
      type: "email",
    })
    return error ? error.message : null
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  // Visitor profile for non-logged-in users
  const effectiveProfile = profile || {
    id: "",
    email: "",
    full_name: null,
    avatar_url: null,
    role: "visitor",
    quality_role: null,
    production_access: null,
    custom_permissions: null,
    is_active: true,
  }

  return (
    <AuthContext.Provider value={{ user, profile: effectiveProfile, loading, signIn, startEmailCode, verifyEmailCode, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
