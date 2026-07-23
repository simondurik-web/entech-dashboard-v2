"use client"

import { Sidebar } from "@/components/layout/Sidebar"
// Bottom nav removed — sidebar handles all navigation
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
  ShoppingCart,
  CircleDot,
  Disc,
  AlertTriangle,
  FileText,
  Printer,
  Search,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { usePermissions } from "@/lib/use-permissions"
import { useQualityAccess } from "@/lib/use-quality-access"
import { useI18n } from "@/lib/i18n"

const baseCommandPaletteItems = [
  { label: 'Orders', href: '/orders', section: 'Production', icon: <ClipboardList className="size-4" /> },
  { label: 'Need to Make', href: '/need-to-make', section: 'Production', icon: <Factory className="size-4" /> },
  { label: 'Need to Package', href: '/need-to-package', section: 'Production', icon: <Package className="size-4" /> },
  { label: 'Staged', href: '/staged', section: 'Production', icon: <PackageCheck className="size-4" /> },
  { label: 'Shipped', href: '/shipped', section: 'Production', icon: <Truck className="size-4" /> },
  { label: 'Inventory', href: '/inventory', section: 'Production', icon: <Archive className="size-4" /> },
  { label: 'Inventory History', href: '/inventory-history', section: 'Production', icon: <TrendingUp className="size-4" /> },
  { label: 'Drawings', href: '/drawings', section: 'Production', icon: <Ruler className="size-4" /> },
  { label: 'Pallet Photos', href: '/pallet-photos', section: 'Production', icon: <Camera className="size-4" /> },
  { label: 'Shipping Records', href: '/shipping-records', section: 'Production', icon: <Truck className="size-4" /> },
  { label: 'Shipping Overview', href: '/shipping-overview', section: 'Production', icon: <Ship className="size-4" /> },
  { label: 'nav.shipmentsOverview', href: '/shipments', section: 'nav.shipments', icon: <PackageCheck className="size-4" />, translate: true },
  { label: 'nav.shipmentsAnalytics', href: '/shipments/analytics', section: 'nav.shipments', icon: <BarChart3 className="size-4" />, translate: true },
  { label: 'nav.shipmentsExplorer', href: '/shipments/explorer', section: 'nav.shipments', icon: <Search className="size-4" />, translate: true },
  { label: 'nav.shipmentsPrintFiles', href: '/shipments/print', section: 'nav.shipments', icon: <Printer className="size-4" />, translate: true },
  { label: 'Scheduling', href: '/scheduling', section: 'Production', icon: <CalendarDays className="size-4" /> },
  { label: 'Labels', href: '/labels', section: 'Production', icon: <Tag className="size-4" /> },
  { label: 'Bill of Materials', href: '/bom', section: 'Production', icon: <Layers className="size-4" /> },
  { label: 'Material Requirements', href: '/material-requirements', section: 'Production', icon: <Package className="size-4" /> },
  { label: 'FP Reference', href: '/fp-reference', section: 'Production', icon: <ClipboardCheck className="size-4" /> },
  { label: 'Customer Reference', href: '/customer-reference', section: 'Production', icon: <Users className="size-4" /> },
  { label: 'Quotes', href: '/quotes', section: 'Production', icon: <DollarSign className="size-4" /> },
  { label: 'Purchasing', href: '/purchasing', section: 'Production', icon: <ShoppingCart className="size-4" /> },
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
  const { canSeeQuality, canManageQuality, canEditLimits } = useQualityAccess()
  const { t } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [headerHidden, setHeaderHidden] = useState(false)
  const commandPaletteItems = useMemo(
    () => {
      const base = baseCommandPaletteItems
        .filter((item) => !item.href || canAccess(item.href))
        .map((item) =>
          'translate' in item && item.translate
            ? { ...item, label: t(item.label), section: t(item.section) }
            : item
        )
      if (!canSeeQuality) return base
      // Quality entries are gated by the QA role (not canAccess), so they're
      // added here rather than living in baseCommandPaletteItems.
      const quality = [
        { label: `${t('nav.quality')} · ${t('nav.qualityDashboard')}`, href: '/quality', section: 'Quality', icon: <ClipboardCheck className="size-4" /> },
        { label: t('nav.qualityHubs'), href: '/quality/hubs', section: 'Quality', icon: <CircleDot className="size-4" /> },
        { label: t('nav.qualityTires'), href: '/quality/tires', section: 'Quality', icon: <Disc className="size-4" /> },
        { label: t('nav.qualityFinished'), href: '/quality/finished', section: 'Quality', icon: <PackageCheck className="size-4" /> },
        { label: t('nav.qualityNcr'), href: '/quality/ncr', section: 'Quality', icon: <AlertTriangle className="size-4" /> },
        ...(canManageQuality ? [
          { label: t('nav.qualityProducts'), href: '/quality/products', section: 'Quality', icon: <Package className="size-4" /> },
          { label: t('nav.qualityUsers'), href: '/quality/users', section: 'Quality', icon: <Users className="size-4" /> },
          { label: t('nav.qualityAudit'), href: '/quality/audit', section: 'Quality', icon: <FileText className="size-4" /> },
        ] : []),
        ...(canEditLimits ? [
          { label: t('nav.qualityLimits'), href: '/quality/limits', section: 'Quality', icon: <Ruler className="size-4" /> },
        ] : []),
      ]
      return [...base, ...quality]
    },
    [canAccess, canSeeQuality, canManageQuality, canEditLimits, t]
  )

  useEffect(() => {
    const stored = localStorage.getItem("dashboard-zoom")
    if (stored) {
      const val = parseFloat(stored)
      // Restore persisted UI state after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Mobile header auto-hide: slide away while scrolling down, reveal on the first
  // scroll up (Simon 2026-07-10 — the bar is noise while reading; the sidebar toggle
  // is one small upward swipe away). Desktop is unaffected (header is lg:hidden).
  useEffect(() => {
    let lastY = window.scrollY
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        const y = window.scrollY
        // small dead-zone so tap-scroll jitter doesn't flicker the bar; skip on
        // desktop entirely (header is lg:hidden — no point re-rendering the layout)
        if (window.innerWidth < 1024 && Math.abs(y - lastY) > 8) {
          setHeaderHidden(y > lastY && y > 56)
        }
        lastY = y
        frame = 0
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
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
        
        {/* Top header - mobile/tablet only (sidebar handles nav on desktop).
            Icon-only (no app-name text — wasted width on a phone) and it slides out
            of the way while scrolling down, back in on scroll up. */}
        <header
          className={`sticky top-0 z-30 border-b bg-background lg:hidden transition-transform duration-200 ${
            headerHidden ? "-translate-y-full" : "translate-y-0"
          }`}
        >
          <div className="flex h-12 items-center gap-3 px-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-md p-2.5 -ml-2.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Open sidebar"
            >
              <PanelLeft className="size-6" />
            </button>
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
        <main className="pb-4" style={{ zoom: zoomLevel, '--app-zoom': zoomLevel } as React.CSSProperties}>
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
      {/* Bottom nav removed; version badge removed (Simon 2026-07-10 — it was a
          load-verification aid, not a feature) */}
    </div>
  )
}
