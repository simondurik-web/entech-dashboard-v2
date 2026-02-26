"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "./supabase"
import { useAuth } from "./auth-context"

type RolePermission = {
  role: string
  menu_access: Record<string, boolean>
}

let cachedPermissions: RolePermission[] | null = null

export function usePermissions() {
  const { profile } = useAuth()
  const [permissions, setPermissions] = useState<RolePermission[]>(cachedPermissions || [])

  useEffect(() => {
    if (cachedPermissions) {
      setPermissions(cachedPermissions)
      return
    }
    supabase
      .from("role_permissions")
      .select("role, menu_access")
      .then(({ data }) => {
        if (data) {
          cachedPermissions = data as RolePermission[]
          setPermissions(data as RolePermission[])
        }
      })
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
      return rolePerm.menu_access[path] === true
    },
    [profile, permissions]
  )

  const refreshPermissions = useCallback(async () => {
    const { data } = await supabase.from("role_permissions").select("role, menu_access")
    if (data) {
      cachedPermissions = data as RolePermission[]
      setPermissions(data as RolePermission[])
    }
  }, [])

  return { canAccess, permissions, refreshPermissions }
}

// Clear cache (useful after admin updates permissions)
export function clearPermissionsCache() {
  cachedPermissions = null
}
