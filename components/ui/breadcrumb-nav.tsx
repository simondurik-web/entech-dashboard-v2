'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'

const pathLabels: Record<string, string> = {
  orders: 'Orders',
  'need-to-make': 'Need to Make',
  'need-to-package': 'Need to Package',
  staged: 'Staged',
  shipped: 'Shipped',
  inventory: 'Inventory',
  'inventory-history': 'Inventory History',
  'sales-overview': 'Sales Overview',
  'sales-parts': 'Sales by Part',
  'sales-customers': 'Sales by Customer',
  'sales-dates': 'Sales by Date',
  bom: 'Bill of Materials',
  scheduling: 'Scheduling',
  labels: 'Labels',
  quotes: 'Quotes',
  drawings: 'Drawings',
  reports: 'Reports',
  admin: 'Admin',
}

const sectionMap: Record<string, string> = {
  orders: 'Production', 'need-to-make': 'Production', 'need-to-package': 'Production',
  staged: 'Production', shipped: 'Production', inventory: 'Production',
  'inventory-history': 'Production', bom: 'Production', scheduling: 'Production',
  labels: 'Production', drawings: 'Production',
  'sales-overview': 'Sales', 'sales-parts': 'Sales', 'sales-customers': 'Sales', 'sales-dates': 'Sales',
  admin: 'Admin', reports: 'Reports', quotes: 'Quotes',
}

export function BreadcrumbNav() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const pageKey = segments[segments.length - 1]
  const section = sectionMap[pageKey]
  const label = pathLabels[pageKey] || pageKey

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
      <Link href="/" className="hover:text-foreground transition-colors">
        <Home className="size-3.5" />
      </Link>
      <ChevronRight className="size-3" />
      {section && (
        <>
          <span>{section}</span>
          <ChevronRight className="size-3" />
        </>
      )}
      <span className="text-foreground font-medium">{label}</span>
    </nav>
  )
}
