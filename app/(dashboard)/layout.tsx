"use client"

import { Sidebar } from "@/components/layout/Sidebar"
// Bottom nav removed — sidebar handles all navigation
import { VersionBadge } from "@/components/layout/VersionBadge"
import { AccessGuard } from "@/components/layout/AccessGuard"
import { PageTransition } from "@/components/ui/page-transition"
import { NotificationBell } from "@/components/NotificationBell"
import { PanelLeft } from "lucide-react"
import { useEffect, useState } from "react"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)

  useEffect(() => {
    const stored = localStorage.getItem("dashboard-zoom")
    if (stored) {
      const val = parseFloat(stored)
      if (!isNaN(val)) setZoomLevel(val)
    }
    const handler = (e: Event) => {
      const zoom = (e as CustomEvent).detail?.zoom
      if (typeof zoom === "number") setZoomLevel(zoom)
    }
    window.addEventListener("zoom-changed", handler)

    // Listen for sidebar pin changes
    const pinned = localStorage.getItem("sidebar-pinned") === "true"
    setSidebarPinned(pinned)
    const pinHandler = (e: Event) => {
      const pin = (e as CustomEvent).detail?.pinned
      setSidebarPinned(pin)
    }
    window.addEventListener("sidebar-pin-changed", pinHandler)

    return () => {
      window.removeEventListener("zoom-changed", handler)
      window.removeEventListener("sidebar-pin-changed", pinHandler)
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area - dynamic offset based on sidebar state */}
      <div
        className="transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ paddingLeft: sidebarPinned ? "16rem" : "3.5rem" }}
      >
        {/* Remove padding on mobile where sidebar is overlay */}
        <style>{`
          @media (max-width: 1023px) {
            .transition-all[style*="padding-left"] { padding-left: 0 !important; }
          }
        `}</style>
        
        {/* Top header - mobile/tablet only (sidebar handles nav on desktop) */}
        <header className="sticky top-0 z-30 border-b bg-background lg:hidden">
          <div className="flex h-14 items-center gap-3 px-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Open sidebar"
            >
              <PanelLeft className="size-5" />
            </button>
            <span className="text-lg font-semibold">
              Entech Dashboard
            </span>
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </div>
        </header>

        {/* Desktop notification bell — fixed top right */}
        <div className="hidden lg:block fixed top-2 right-4 z-40">
          <NotificationBell />
        </div>

        {/* Main content - pad bottom on mobile for nav bar */}
        <main className="pb-4" style={{ zoom: zoomLevel }}>
          <AccessGuard>
            <PageTransition>{children}</PageTransition>
          </AccessGuard>
        </main>
      </div>

      {/* Bottom nav removed */}
      <VersionBadge />
    </div>
  )
}
