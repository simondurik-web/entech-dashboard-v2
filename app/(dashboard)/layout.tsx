"use client"

import { Sidebar } from "@/components/layout/Sidebar"
import { BottomNav } from "@/components/layout/bottom-nav"
import { PanelLeft } from "lucide-react"
import { useEffect, useState } from "react"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
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
    return () => window.removeEventListener("zoom-changed", handler)
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area - offset on desktop for sidebar */}
      <div className="lg:pl-64">
        {/* Top header - mobile/tablet only on large screens sidebar replaces it */}
        <header className="sticky top-0 z-30 border-b bg-background">
          <div className="flex h-14 items-center gap-3 px-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
              aria-label="Open sidebar"
            >
              <PanelLeft className="size-5" />
            </button>
            <span className="text-lg font-semibold lg:hidden">
              Entech Dashboard
            </span>
          </div>
        </header>

        {/* Main content - pad bottom on mobile for nav bar */}
        <main className="pb-20 md:pb-0" style={{ zoom: zoomLevel }}>{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  )
}
