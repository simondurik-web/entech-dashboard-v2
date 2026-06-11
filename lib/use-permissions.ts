"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "./supabase"
import { useAuth } from "./auth-context"

type RolePermission = {
  role: string
  menu_access: Record<string, boolean>
}

// Device-side cache of the role_permissions table so the menu/role gating
// renders instantly on boot instead of waiting a network round trip. The
// table is small, non-secret (it's only a UI gate — every API route does its
// own server-side authorization), and changes rarely; a background refetch on
// first mount keeps it current within ~1s of page load.
const PERMS_CACHE_KEY = "edv2.perms.v1"

function readStoredPermissions(): RolePermission[] | null {
  try {
    const raw = localStorage.getItem(PERMS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RolePermission[]) : null
  } catch {
    return null
  }
}

function writeStoredPermissions(perms: RolePermission[]) {
  try {
    localStorage.setItem(PERMS_CACHE_KEY, JSON.stringify(perms))
  } catch {
    // storage blocked — cache is best-effort
  }
}

let cachedPermissions: RolePermission[] | null = null
// Whether this page load has refetched from the DB yet. The localStorage
// seed alone must not suppress the refetch (it could be stale).
let revalidatedThisLoad = false
// Every mounted hook instance, so a fetch completion reaches ALL of them.
// Without this, an instance that mounts while another instance's fetch is
// in flight (fresh browser: AccessGuard mounts right after Sidebar starts
// the fetch) skips the fetch via revalidatedThisLoad and its permissions
// state stays [] forever — it deadlocks on Access Denied.
const subscribers = new Set<(perms: RolePermission[]) => void>()
function broadcastPermissions(perms: RolePermission[]) {
  subscribers.forEach((notify) => notify(perms))
}

const PATH_FALLBACKS: Record<string, string[]> = {
  // No fallbacks — each path must be explicitly granted
}

export function usePermissions() {
  const { profile } = useAuth()
  const [permissions, setPermissions] = useState<RolePermission[]>(
    cachedPermissions || [],
  )

  useEffect(() => {
    // Stay subscribed for the lifetime of the instance so a fetch finishing
    // after mount (or triggered by a later instance) still lands here.
    subscribers.add(setPermissions)
    // Seed from the device cache post-hydration (server and client first
    // paint both render with [] — no hydration mismatch).
    if (!cachedPermissions) {
      const stored = readStoredPermissions()
      if (stored && stored.length > 0) {
        cachedPermissions = stored
        setPermissions(stored)
      }
    } else {
      setPermissions(cachedPermissions)
    }
    if (!revalidatedThisLoad) {
      revalidatedThisLoad = true
      supabase
        .from("role_permissions")
        .select("role, menu_access")
        .then(({ data }) => {
          if (data && data.length > 0) {
            cachedPermissions = data as RolePermission[]
            writeStoredPermissions(cachedPermissions)
            broadcastPermissions(cachedPermissions)
          } else {
            // Failed/empty fetch — let the next mount retry instead of leaving
            // the whole SPA session with empty menus.
            revalidatedThisLoad = false
          }
        })
    }
    return () => {
      subscribers.delete(setPermissions)
    }
  }, [])

  const canAccess = useCallback(
    (path: string): boolean => {
      if (!profile) return false

      // Admin / Super Admin always has access
      if (profile.role === "admin" || profile.role === "super_admin") return true

      // Check custom_permissions first (manager overrides)
      if (profile.custom_permissions && path in profile.custom_permissions) {
        return profile.custom_permissions[path] === true
      }

      // Check role-based permissions
      const rolePerm = permissions.find((p) => p.role === profile.role)
      if (!rolePerm) return false
      // Exact match first
      if (rolePerm.menu_access[path] === true) return true
      for (const fallbackPath of PATH_FALLBACKS[path] ?? []) {
        if (rolePerm.menu_access[fallbackPath] === true) return true
      }
      // Sub-path match: /quotes/new should match /quotes permission
      const segments = path.split("/").filter(Boolean)
      while (segments.length > 1) {
        segments.pop()
        const parentPath = "/" + segments.join("/")
        if (rolePerm.menu_access[parentPath] === true) return true
      }
      return false
    },
    [profile, permissions]
  )

  const refreshPermissions = useCallback(async () => {
    const { data } = await supabase.from("role_permissions").select("role, menu_access")
    if (data) {
      cachedPermissions = data as RolePermission[]
      writeStoredPermissions(cachedPermissions)
      broadcastPermissions(cachedPermissions)
    }
  }, [])

  return { canAccess, permissions, refreshPermissions, userId: profile?.id ?? null }
}

// Clear cache (useful after admin updates permissions)
export function clearPermissionsCache() {
  cachedPermissions = null
  revalidatedThisLoad = false
  try {
    localStorage.removeItem(PERMS_CACHE_KEY)
  } catch {
    // ignore
  }
}
