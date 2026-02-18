"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n"
import { useAuth } from "@/lib/auth-context"
import { usePermissions } from "@/lib/use-permissions"
import {
  ClipboardList,
  Factory,
  Package,
  PackageCheck,
  Truck,
  Archive,
  TrendingUp,
  Ruler,
  Camera,
  FileText,
  Bot,
  PanelLeftClose,
  Sun,
  Moon,
  Layers,
  ClipboardCheck,
  Users,
  DollarSign,
  Database,
  BarChart3,
  CalendarDays,
  Wrench,
  LogIn,
  LogOut,
  Shield,
  Settings,
} from "lucide-react"
import { LanguageToggle } from "./LanguageToggle"
import { ZoomControls } from "./ZoomControls"

type NavItem = {
  /** Translation key — resolved via t() */
  tKey: string
  href: string
  icon: React.ReactNode
  sub?: boolean
}

const productionItems: NavItem[] = [
  { tKey: "nav.ordersData", href: "/orders", icon: <ClipboardList className="size-4" /> },
  { tKey: "nav.productionMake", href: "/need-to-make", icon: <Factory className="size-4" />, sub: true },
  { tKey: "nav.ordersQueue", href: "/need-to-package", icon: <Package className="size-4" />, sub: true },
  { tKey: "nav.ordersStaged", href: "/staged", icon: <PackageCheck className="size-4" />, sub: true },
  { tKey: "nav.ordersShipped", href: "/shipped", icon: <Truck className="size-4" />, sub: true },
  { tKey: "nav.inventory", href: "/inventory", icon: <Archive className="size-4" /> },
  { tKey: "nav.inventoryHistory", href: "/inventory-history", icon: <TrendingUp className="size-4" />, sub: true },
  { tKey: "nav.drawingsLibrary", href: "/drawings", icon: <Ruler className="size-4" />, sub: true },
  { tKey: "nav.palletRecords", href: "/pallet-records", icon: <Camera className="size-4" /> },
  { tKey: "nav.shippingRecords", href: "/shipping-records", icon: <Truck className="size-4" /> },
  { tKey: "nav.bom", href: "/bom", icon: <Layers className="size-4" /> },
  { tKey: "nav.materialReqs", href: "/material-requirements", icon: <Package className="size-4" />, sub: true },
  { tKey: "nav.fpReference", href: "/fp-reference", icon: <ClipboardCheck className="size-4" /> },
  { tKey: "nav.customerRef", href: "/customer-reference", icon: <Users className="size-4" /> },
  { tKey: "nav.quotes", href: "/quotes", icon: <DollarSign className="size-4" /> },
]

const salesItems: NavItem[] = [
  { tKey: "nav.salesOverview", href: "/sales-overview", icon: <BarChart3 className="size-4" /> },
  { tKey: "nav.salesByPart", href: "/sales-parts", icon: <Wrench className="size-4" />, sub: true },
  { tKey: "nav.salesByCustomer", href: "/sales-customers", icon: <Users className="size-4" />, sub: true },
  { tKey: "nav.salesByDate", href: "/sales-dates", icon: <CalendarDays className="size-4" />, sub: true },
]

const adminItems: NavItem[] = [
  { tKey: "User Management", href: "/admin/users", icon: <Users className="size-4" /> },
  { tKey: "Role Permissions", href: "/admin/permissions", icon: <Settings className="size-4" /> },
]

const ROLE_LABELS: Record<string, string> = {
  visitor: "Visitor",
  regular_user: "User",
  group_leader: "Group Leader",
  manager: "Manager",
  admin: "Admin",
}

const ROLE_COLORS: Record<string, string> = {
  visitor: "bg-gray-500/30 text-gray-300",
  regular_user: "bg-blue-500/30 text-blue-300",
  group_leader: "bg-green-500/30 text-green-300",
  manager: "bg-purple-500/30 text-purple-300",
  admin: "bg-red-500/30 text-red-300",
}

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()
  const { user, profile, signIn, signOut } = useAuth()
  const { canAccess } = usePermissions()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const filteredProduction = productionItems.filter((item) => canAccess(item.href))
  const filteredSales = salesItems.filter((item) => canAccess(item.href))
  const showAllData = canAccess("/all-data")
  const isAdmin = profile?.role === "admin"

  const renderNavItem = (item: NavItem, useTranslation = true) => {
    const isActive = pathname === item.href
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onClose}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
            item.sub && "ml-4 text-xs",
            isActive
              ? "bg-white/20 font-medium text-white shadow-sm"
              : "text-white/80 hover:translate-x-0.5 hover:bg-white/10 hover:text-white"
          )}
        >
          {item.icon}
          <span>{useTranslation ? t(item.tKey) : item.tKey}</span>
        </Link>
      </li>
    )
  }

  return (
    <>
      {/* Backdrop for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto",
          "bg-gradient-to-b from-[#1a365d] to-[#2c5282] text-white",
          "dark:from-[#0f1f38] dark:to-[#1a365d]",
          "transition-transform duration-300 ease-in-out",
          "lg:translate-x-0 lg:z-30",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo section */}
        <div className="flex items-center justify-between px-4 py-5">
          <div>
            <h1 className="text-lg font-bold tracking-wide">Molding</h1>
            <p className="text-xs text-white/70">Operations Dashboard</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="size-5" />
          </button>
        </div>

        {/* Toggle controls */}
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
          <LanguageToggle />
          {mounted && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="size-3.5" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="size-3.5" />
                  <span>Dark</span>
                </>
              )}
            </button>
          )}
        </div>

        <ZoomControls />

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4">
          {filteredProduction.length > 0 && (
            <>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
                {t('nav.production')}
              </p>
              <ul className="space-y-0.5">
                {filteredProduction.map((item) => renderNavItem(item))}
              </ul>
            </>
          )}

          {filteredSales.length > 0 && (
            <>
              <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
                {t('nav.salesFinance')}
              </p>
              <ul className="space-y-0.5">
                {filteredSales.map((item) => renderNavItem(item))}
              </ul>
            </>
          )}

          {showAllData && (
            <>
              <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
                {t('nav.rawData')}
              </p>
              <ul className="space-y-0.5">
                <li>
                  <Link
                    href="/all-data"
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                      pathname === "/all-data"
                        ? "bg-white/20 font-medium text-white shadow-sm"
                        : "text-white/80 hover:translate-x-0.5 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <Database className="size-4" />
                    <span>All Data</span>
                  </Link>
                </li>
              </ul>
            </>
          )}

          {isAdmin && (
            <>
              <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
                ADMIN
              </p>
              <ul className="space-y-0.5">
                {adminItems.map((item) => renderNavItem(item, false))}
              </ul>
            </>
          )}
        </nav>

        {/* Phil Assistant */}
        <div className="border-t border-white/10 px-3 py-3">
          <button className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white">
            <Bot className="size-4" />
            <span>{t('nav.aiAssistant')}</span>
          </button>
        </div>

        {/* Auth section */}
        <div className="border-t border-white/10 px-3 py-3">
          {user && profile ? (
            <div className="flex items-center gap-3">
              {profile.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="size-8 rounded-full"
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                  {(profile.full_name || profile.email || "?")[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {profile.full_name || profile.email}
                </p>
                <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", ROLE_COLORS[profile.role] || ROLE_COLORS.visitor)}>
                  {ROLE_LABELS[profile.role] || profile.role}
                </span>
              </div>
              <button
                onClick={signOut}
                className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                title="Sign out"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={signIn}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              <LogIn className="size-4" />
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
