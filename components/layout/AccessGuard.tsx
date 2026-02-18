"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { usePermissions } from "@/lib/use-permissions"
import { LogIn } from "lucide-react"
import type { ReactNode } from "react"

export function AccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { user, loading, signIn } = useAuth()
  const { canAccess } = usePermissions()

  if (loading) return <>{children}</>

  // Admin paths need admin role
  if (pathname.startsWith("/admin")) {
    if (!canAccess(pathname)) {
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8">
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-8 text-center">
            <h2 className="mb-2 text-xl font-semibold">Admin Access Required</h2>
            <p className="mb-4 text-muted-foreground">
              You need admin privileges to view this page.
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
          <h2 className="mb-2 text-xl font-semibold">Access Restricted</h2>
          <p className="mb-4 text-muted-foreground">
            You don&apos;t have permission to view this page.
          </p>
          {!user && (
            <button
              onClick={signIn}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <LogIn className="size-4" />
              Sign in with Google
            </button>
          )}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
