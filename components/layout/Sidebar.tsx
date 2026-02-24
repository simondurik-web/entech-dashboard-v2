"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState, useRef } from "react"
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
  FileBarChart,
  ChevronRight,
  Bell,
} from "lucide-react"
import { LanguageToggle } from "./LanguageToggle"
import { ZoomControls } from "./ZoomControls"
import { CollapsibleNavSection } from "@/components/ui/collapsible-nav"

type NavItem = {
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
  { tKey: "Notifications", href: "/admin/notifications", icon: <Bell className="size-4" /> },
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
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null)
  const leaveTimeout = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setMounted(true)
    // Restore pin state
    const stored = localStorage.getItem("sidebar-pinned")
    if (stored === "true") setPinned(true)
  }, [])

  const expanded = hovered || pinned

  const handleMouseEnter = () => {
    if (leaveTimeout.current) { clearTimeout(leaveTimeout.current); leaveTimeout.current = null }
    hoverTimeout.current = setTimeout(() => setHovered(true), 80)
  }

  const handleMouseLeave = () => {
    if (hoverTimeout.current) { clearTimeout(hoverTimeout.current); hoverTimeout.current = null }
    leaveTimeout.current = setTimeout(() => setHovered(false), 300)
  }

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    localStorage.setItem("sidebar-pinned", String(next))
    // Notify layout of pin change
    window.dispatchEvent(new CustomEvent("sidebar-pin-changed", { detail: { pinned: next } }))
  }

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
          title={!expanded ? (useTranslation ? t(item.tKey) : item.tKey) : undefined}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150 whitespace-nowrap overflow-hidden",
            item.sub && expanded && "ml-4 text-xs",
            item.sub && !expanded && "ml-0 text-xs",
            isActive
              ? "bg-white/15 font-medium text-white shadow-sm shadow-white/5 border-l-2 border-white/70"
              : "text-white/70 hover:translate-x-0.5 hover:bg-white/[0.08] hover:text-white border-l-2 border-transparent"
          )}
        >
          <span className="shrink-0">{item.icon}</span>
          <span className={cn(
            "transition-all duration-300",
            expanded ? "opacity-100 w-auto" : "opacity-0 w-0"
          )}>
            {useTranslation ? t(item.tKey) : item.tKey}
          </span>
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

      {/* Desktop hover trigger zone — always visible thin strip */}
      <div
        className="fixed inset-y-0 left-0 z-40 hidden lg:block"
        style={{ width: expanded ? "16rem" : "3.5rem" }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <aside
          className={cn(
            "h-full flex flex-col overflow-y-auto overflow-x-hidden",
            "bg-gradient-to-b from-[#2b6cb0] to-[#2c5282] text-white",
            "dark:from-[#0f1f38] dark:to-[#1a365d]",
            "transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            expanded ? "w-64 shadow-2xl shadow-blue-900/40" : "w-14",
            !expanded && "opacity-50 hover:opacity-100",
          )}
        >
          {/* Logo section */}
          <div className="flex items-center justify-between px-3 py-5 min-h-[72px]">
            <div className={cn("overflow-hidden transition-all duration-300", expanded ? "opacity-100" : "opacity-0 w-0")}>
              <h1 className="text-lg font-bold tracking-wide whitespace-nowrap">Molding</h1>
              <p className="text-xs text-white/70 whitespace-nowrap">Operations Dashboard</p>
            </div>
            {!expanded && (
              <div className="mx-auto">
                <ChevronRight className="size-4 text-white/50 animate-pulse" />
              </div>
            )}
            {expanded && (
              <button
                onClick={togglePin}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  pinned ? "text-white bg-white/20" : "text-white/50 hover:bg-white/10 hover:text-white"
                )}
                title={pinned ? "Unpin sidebar" : "Pin sidebar open"}
              >
                <svg className="size-4" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="17" x2="12" y2="22" />
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                </svg>
              </button>
            )}
          </div>

          {/* Toggle controls */}
          {expanded && (
            <div className="flex items-center gap-2 border-t border-white/10 px-3 py-3">
              <LanguageToggle />
              {mounted && (
                <button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                  aria-label="Toggle theme"
                >
                  {theme === "dark" ? <><Sun className="size-3.5" /><span>Light</span></> : <><Moon className="size-3.5" /><span>Dark</span></>}
                </button>
              )}
            </div>
          )}

          {expanded && <ZoomControls />}

          {/* Navigation */}
          <nav className="flex-1 px-2 py-4">
            {filteredProduction.length > 0 && (
              <CollapsibleNavSection label={t('nav.production')} expanded={expanded} storageKey="production">
                <ul className="space-y-0.5">
                  {filteredProduction.map((item) => renderNavItem(item))}
                </ul>
              </CollapsibleNavSection>
            )}

            {filteredSales.length > 0 && (
              <CollapsibleNavSection label={t('nav.salesFinance')} expanded={expanded} storageKey="sales" defaultOpen={true}>
                <ul className="space-y-0.5 mt-1">
                  {filteredSales.map((item) => renderNavItem(item))}
                </ul>
              </CollapsibleNavSection>
            )}

            {/* Reports */}
            <CollapsibleNavSection label="REPORTS" expanded={expanded} storageKey="reports" defaultOpen={true}>
            <ul className="space-y-0.5 mt-1">
              {renderNavItem({ tKey: "Custom Reports", href: "/reports", icon: <FileBarChart className="size-4" /> }, false)}
            </ul>
            </CollapsibleNavSection>

            {/* Notifications */}
            <ul className="space-y-0.5 mt-1">
              {renderNavItem({ tKey: "Notifications", href: "/notifications", icon: <Bell className="size-4" /> }, false)}
            </ul>

            {showAllData && (
              <CollapsibleNavSection label={t('nav.rawData')} expanded={expanded} storageKey="raw-data" defaultOpen={true}>
                <ul className="space-y-0.5 mt-1">
                  {renderNavItem({ tKey: "All Data", href: "/all-data", icon: <Database className="size-4" /> }, false)}
                </ul>
              </CollapsibleNavSection>
            )}

            {isAdmin && (
              <CollapsibleNavSection label="ADMIN" expanded={expanded} storageKey="admin" defaultOpen={true}>
                <ul className="space-y-0.5 mt-1">
                  {adminItems.map((item) => renderNavItem(item, false))}
                </ul>
              </CollapsibleNavSection>
            )}
          </nav>

          {/* Phil Assistant */}
          {canAccess('/phil-assistant') && (
            <div className={cn(
              "border-t border-white/10 px-2 py-3 overflow-hidden transition-all duration-300",
              !expanded && "px-1"
            )}>
              <Link
                href="/phil-assistant"
                onClick={onClose}
                className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white overflow-hidden"
                title={!expanded ? t('nav.aiAssistant') : undefined}
              >
                <span className="shrink-0"><Bot className="size-4" /></span>
                <span className={cn("transition-all duration-300 whitespace-nowrap", expanded ? "opacity-100 w-auto" : "opacity-0 w-0")}>
                  {t('nav.aiAssistant')}
                </span>
              </Link>
            </div>
          )}

          {/* Auth section */}
          <div className={cn(
            "border-t border-white/10 px-2 py-3 transition-all duration-300",
            !expanded && "px-1"
          )}>
            {user && profile ? (
              <div className="flex items-center gap-2">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="size-8 rounded-full shrink-0" />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold shrink-0">
                    {(profile.full_name || profile.email || "?")[0].toUpperCase()}
                  </div>
                )}
                <div className={cn("min-w-0 flex-1 transition-all duration-300 overflow-hidden", expanded ? "opacity-100 w-auto" : "opacity-0 w-0")}>
                  <p className="truncate text-xs font-medium">{profile.full_name || profile.email}</p>
                  <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", ROLE_COLORS[profile.role] || ROLE_COLORS.visitor)}>
                    {ROLE_LABELS[profile.role] || profile.role}
                  </span>
                </div>
                {expanded && (
                  <button
                    onClick={signOut}
                    className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white shrink-0"
                    title="Sign out"
                  >
                    <LogOut className="size-4" />
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={signIn}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white overflow-hidden"
                title={!expanded ? "Sign in" : undefined}
              >
                <span className="shrink-0"><LogIn className="size-4" /></span>
                <span className={cn("transition-all duration-300 whitespace-nowrap", expanded ? "opacity-100 w-auto" : "opacity-0 w-0")}>Sign in with Google</span>
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Mobile sidebar - standard overlay */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col overflow-y-auto lg:hidden",
          "bg-gradient-to-b from-[#2b6cb0] to-[#2c5282] text-white",
          "dark:from-[#0f1f38] dark:to-[#1a365d]",
          "transition-transform duration-300 ease-in-out",
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
            className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
          <LanguageToggle />
          {mounted && (
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
            >
              {theme === "dark" ? <><Sun className="size-3.5" /><span>Light</span></> : <><Moon className="size-3.5" /><span>Dark</span></>}
            </button>
          )}
        </div>

        <ZoomControls />

        <nav className="flex-1 px-3 py-4">
          {filteredProduction.length > 0 && (
            <>
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">{t('nav.production')}</p>
              <ul className="space-y-0.5">
                {filteredProduction.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={onClose} className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                        item.sub && "ml-4 text-xs",
                        isActive ? "bg-white/15 font-medium text-white shadow-sm shadow-white/5 border-l-2 border-white/70" : "text-white/70 hover:translate-x-0.5 hover:bg-white/[0.08] hover:text-white border-l-2 border-transparent"
                      )}>
                        {item.icon}
                        <span>{t(item.tKey)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          {filteredSales.length > 0 && (
            <>
              <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">{t('nav.salesFinance')}</p>
              <ul className="space-y-0.5">
                {filteredSales.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={onClose} className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                        item.sub && "ml-4 text-xs",
                        isActive ? "bg-white/15 font-medium text-white shadow-sm shadow-white/5 border-l-2 border-white/70" : "text-white/70 hover:translate-x-0.5 hover:bg-white/[0.08] hover:text-white border-l-2 border-transparent"
                      )}>
                        {item.icon}
                        <span>{t(item.tKey)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}

          <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">REPORTS</p>
          <ul className="space-y-0.5">
            <li>
              <Link href="/reports" onClick={onClose} className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                pathname === "/reports" ? "bg-white/15 font-medium text-white shadow-sm shadow-white/5 border-l-2 border-white/70" : "text-white/70 hover:translate-x-0.5 hover:bg-white/[0.08] hover:text-white border-l-2 border-transparent"
              )}>
                <FileBarChart className="size-4" />
                <span>Custom Reports</span>
              </Link>
            </li>
          </ul>

          {showAllData && (
            <>
              <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">{t('nav.rawData')}</p>
              <ul className="space-y-0.5">
                <li>
                  <Link href="/all-data" onClick={onClose} className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                    pathname === "/all-data" ? "bg-white/15 font-medium text-white shadow-sm shadow-white/5 border-l-2 border-white/70" : "text-white/70 hover:translate-x-0.5 hover:bg-white/[0.08] hover:text-white border-l-2 border-transparent"
                  )}>
                    <Database className="size-4" />
                    <span>All Data</span>
                  </Link>
                </li>
              </ul>
            </>
          )}

          {isAdmin && (
            <>
              <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">ADMIN</p>
              <ul className="space-y-0.5">
                {adminItems.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={onClose} className={cn(
                        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all duration-150",
                        isActive ? "bg-white/15 font-medium text-white shadow-sm shadow-white/5 border-l-2 border-white/70" : "text-white/70 hover:translate-x-0.5 hover:bg-white/[0.08] hover:text-white border-l-2 border-transparent"
                      )}>
                        {item.icon}
                        <span>{item.tKey}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </nav>

        {canAccess('/phil-assistant') && (
          <div className="border-t border-white/10 px-3 py-3">
            <Link href="/phil-assistant" onClick={onClose} className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white">
              <Bot className="size-4" />
              <span>{t('nav.aiAssistant')}</span>
            </Link>
          </div>
        )}

        <div className="border-t border-white/10 px-3 py-3">
          {user && profile && profile.role !== 'visitor' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="size-8 rounded-full" />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                    {(profile.full_name || profile.email || "?")[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{profile.full_name || profile.email}</p>
                  <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", ROLE_COLORS[profile.role] || ROLE_COLORS.visitor)}>
                    {ROLE_LABELS[profile.role] || profile.role}
                  </span>
                </div>
              </div>
              <button
                onClick={signOut}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/30 hover:text-red-200"
              >
                <LogOut className="size-4" />
                <span>Sign Out</span>
              </button>
            </div>
          ) : (
            <button onClick={signIn} className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white">
              <LogIn className="size-4" />
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
