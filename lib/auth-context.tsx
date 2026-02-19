"use client"

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"
import { supabase } from "./supabase"
import type { User, Session } from "@supabase/supabase-js"

export type UserRole = 'visitor' | 'regular_user' | 'group_leader' | 'manager' | 'admin'

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

  const fetchProfile = useCallback(async (u: User) => {
    try {
      // Upsert profile via API
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: u.id,
          email: u.email,
          full_name: u.user_metadata?.full_name || u.user_metadata?.name || "",
          avatar_url: u.user_metadata?.avatar_url || u.user_metadata?.picture || "",
        }),
      })
      if (res.ok) {
        const data = await res.json()
        // Enforce super admin — always admin regardless of DB
        if (isSuperAdmin(u.email) && data.profile) {
          data.profile.role = 'admin'
        }
        setProfile(data.profile)
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err)
    }
  }, [])

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user)
        fetchProfile(session.user)
      }
      setLoading(false)
    })

    // Listen to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (session?.user) {
          setUser(session.user)
          await fetchProfile(session.user)
        } else {
          setUser(null)
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [fetchProfile])

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
