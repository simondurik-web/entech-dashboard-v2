"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import { supabase } from "./supabase"
import type { User, Session } from "@supabase/supabase-js"

export type UserRole = 'visitor' | 'regular_user' | 'group_leader' | 'shipping_manager' | 'manager' | 'admin'

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
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
})

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
  // Re-read the profile on TOKEN_REFRESHED at most this often, so admin role
  // grants/revocations still reach long-lived tabs without a manual reload.
  const ROLE_REFRESH_MS = 15 * 60 * 1000

  const applyProfile = useCallback((u: User, p: UserProfile | null) => {
    // Enforce super admin — always admin regardless of DB
    if (isSuperAdmin(u.email) && p) {
      p.role = 'admin'
    }
    setProfile(p)
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

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        if (loadedForUserRef.current !== session.user.id) {
          loadedForUserRef.current = session.user.id
          loadProfile(session.user, session.access_token)
        }
      }
      setLoading(false)
    })

    // Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user)
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
        } else {
          setUser(null)
          setProfile(null)
          loadedForUserRef.current = null
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: typeof window !== "undefined" ? window.location.origin + "/orders" : undefined,
      },
    })
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
    <AuthContext.Provider value={{ user, profile: effectiveProfile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
