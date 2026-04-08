"use client"

import { Sidebar } from "@/components/layout/Sidebar"
// Bottom nav removed — sidebar handles all navigation
import { VersionBadge } from "@/components/layout/VersionBadge"
import { AccessGuard } from "@/components/layout/AccessGuard"
import { PageTransition } from "@/components/ui/page-transition"
import { ToastProvider } from "@/components/ui/toast-provider"
import { SmoothScroll } from "@/components/ui/smooth-scroll"
import { BreadcrumbNav } from "@/components/ui/breadcrumb-nav"
import { CommandPalette } from "@/components/ui/command-palette"
import { ScrollToTop } from "@/components/ui/scroll-to-top"
import { NotificationBell } from "@/components/NotificationBell"
import {
  PanelLeft,
  ClipboardList,
  Factory,
  Package,
  PackageCheck,
  Ship,
  Truck,
  Archive,
  TrendingUp,
  Ruler,
  Camera,
  CalendarDays,
  Tag,
  Layers,
  ClipboardCheck,
  Users,
  DollarSign,
  BarChart3,
  Wrench,
  Settings,
  Bell,
  FileBarChart,
  Inbox,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { usePermissions } from "@/lib/use-permissions"

const baseCommandPaletteItems = [
  { label: 'Orders', href: '/orders', section: 'Production', icon: <ClipboardList className="size-4" /> },
  { label: 'RollTech Action Center', href: '/rolltech-actions', section: 'Production', icon: <Inbox className="size-4" /> },
  { label: 'Need to Make', href: '/need-to-make', section: 'Production', icon: <Factory className="size-4" /> },
  { label: 'Need to Package', href: '/need-to-package', section: 'Production', icon: <Package className="size-4" /> },
  { label: 'Staged', href: '/staged', section: 'Production', icon: <PackageCheck className="size-4" /> },
  { label: 'Shipped', href: '/shipped', section: 'Production', icon: <Truck className="size-4" /> },
  { label: 'Inventory', href: '/inventory', section: 'Production', icon: <Archive className="size-4" /> },
  { label: 'Inventory History', href: '/inventory-history', section: 'Production', icon: <TrendingUp className="size-4" /> },
  { label: 'Drawings', href: '/drawings', section: 'Production', icon: <Ruler className="size-4" /> },
  { label: 'Pallet Records', href: '/pallet-records', section: 'Production', icon: <Camera className="size-4" /> },
  { label: 'Shipping Records', href: '/shipping-records', section: 'Production', icon: <Truck className="size-4" /> },
  { label: 'Shipping Overview', href: '/shipping-overview', section: 'Production', icon: <Ship className="size-4" /> },
  { label: 'Scheduling', href: '/scheduling', section: 'Production', icon: <CalendarDays className="size-4" /> },
  { label: 'Labels', href: '/labels', section: 'Production', icon: <Tag className="size-4" /> },
  { label: 'Bill of Materials', href: '/bom', section: 'Production', icon: <Layers className="size-4" /> },
  { label: 'Material Requirements', href: '/material-requirements', section: 'Production', icon: <Package className="size-4" /> },
  { label: 'FP Reference', href: '/fp-reference', section: 'Production', icon: <ClipboardCheck className="size-4" /> },
  { label: 'Customer Reference', href: '/customer-reference', section: 'Production', icon: <Users className="size-4" /> },
  { label: 'Quotes', href: '/quotes', section: 'Production', icon: <DollarSign className="size-4" /> },
  { label: 'Sales Overview', href: '/sales-overview', section: 'Sales', icon: <BarChart3 className="size-4" /> },
  { label: 'Sales by Part', href: '/sales-parts', section: 'Sales', icon: <Wrench className="size-4" /> },
  { label: 'Sales by Customer', href: '/sales-customers', section: 'Sales', icon: <Users className="size-4" /> },
  { label: 'Sales by Date', href: '/sales-dates', section: 'Sales', icon: <CalendarDays className="size-4" /> },
  { label: 'User Management', href: '/admin/users', section: 'Admin', icon: <Users className="size-4" /> },
  { label: 'Role Permissions', href: '/admin/permissions', section: 'Admin', icon: <Settings className="size-4" /> },
  { label: 'Notifications', href: '/admin/notifications', section: 'Admin', icon: <Bell className="size-4" /> },
  { label: 'Reports', href: '/reports', section: 'Reports', icon: <FileBarChart className="size-4" /> },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { canAccess } = usePermissions()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const commandPaletteItems = useMemo(
    () => baseCommandPaletteItems.filter((item) => !item.href || canAccess(item.href)),
    [canAccess]
  )

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
          <SmoothScroll>
            <AccessGuard>
              <BreadcrumbNav />
              <PageTransition>{children}</PageTransition>
            </AccessGuard>
          </SmoothScroll>
        </main>
        <ScrollToTop />
      </div>

      <CommandPalette items={commandPaletteItems} />
      <ToastProvider />
      {/* Bottom nav removed */}
      <VersionBadge />
    </div>
  )
}
