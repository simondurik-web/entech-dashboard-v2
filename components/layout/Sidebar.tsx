"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
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
  Lock,
  Bot,
  PanelLeftClose,
  Sun,
  Moon,
} from "lucide-react"
import { LanguageToggle } from "./LanguageToggle"

type NavItem = {
  label: string
  href: string
  icon: React.ReactNode
  sub?: boolean
}

const productionItems: NavItem[] = [
  { label: "Orders Data", href: "/orders", icon: <ClipboardList className="size-4" /> },
  { label: "Need to Make", href: "/need-to-make", icon: <Factory className="size-4" />, sub: true },
  { label: "Need to Package", href: "/need-to-package", icon: <Package className="size-4" />, sub: true },
  { label: "Ready to Ship", href: "/staged", icon: <PackageCheck className="size-4" />, sub: true },
  { label: "Shipped", href: "/shipped", icon: <Truck className="size-4" />, sub: true },
  { label: "Inventory", href: "/inventory", icon: <Archive className="size-4" /> },
  { label: "Inventory History", href: "/inventory-history", icon: <TrendingUp className="size-4" />, sub: true },
  { label: "Drawings", href: "/drawings", icon: <Ruler className="size-4" />, sub: true },
  { label: "Pallet Records", href: "/pallet-records", icon: <Camera className="size-4" /> },
  { label: "Shipping Records", href: "/shipping-records", icon: <Truck className="size-4" /> },
  { label: "Staged Records", href: "/staged-records", icon: <FileText className="size-4" /> },
]

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Hydration sync - safe to set mounted state once on client
    setMounted(true) // eslint-disable-line react/use-effect-no-sync-set-state
  }, [])

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
          {/* Language toggle */}
          <LanguageToggle />

          {/* Theme toggle */}
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4">
          {/* Production section */}
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Production
          </p>
          <ul className="space-y-0.5">
            {productionItems.map((item) => {
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
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>

          {/* Sales & Finance (locked) */}
          <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Sales & Finance
          </p>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/40">
            <Lock className="size-3.5" />
            <span>Coming soon</span>
          </div>

          {/* Raw Data (locked) */}
          <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
            Raw Data
          </p>
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/40">
            <Lock className="size-3.5" />
            <span>Coming soon</span>
          </div>
        </nav>

        {/* Phil Assistant */}
        <div className="border-t border-white/10 px-3 py-3">
          <button className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/20 hover:text-white">
            <Bot className="size-4" />
            <span>Phil Assistant</span>
          </button>
        </div>
      </aside>
    </>
  )
}
