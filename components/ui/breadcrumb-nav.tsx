'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// i18n keys reused from the sidebar nav so breadcrumb and sidebar always agree
const pathLabelKeys: Record<string, string> = {
  orders: 'nav.ordersData',
  'need-to-make': 'nav.productionMake',
  'need-to-package': 'nav.ordersQueue',
  staged: 'nav.ordersStaged',
  shipped: 'nav.ordersShipped',
  inventory: 'nav.inventory',
  'inventory-history': 'nav.inventoryHistory',
  'sales-overview': 'nav.salesOverview',
  'sales-parts': 'nav.salesByPart',
  'sales-customers': 'nav.salesByCustomer',
  'sales-dates': 'nav.salesByDate',
  bom: 'nav.bom',
  scheduling: 'nav.scheduling',
  labels: 'nav.labels',
  quotes: 'nav.quotes',
  drawings: 'nav.drawingsLibrary',
  reports: 'nav.reports',
  admin: 'admin.page',
}

const sectionKeys: Record<string, string> = {
  orders: 'nav.production', 'need-to-make': 'nav.production', 'need-to-package': 'nav.production',
  staged: 'nav.production', shipped: 'nav.production', inventory: 'nav.production',
  'inventory-history': 'nav.production', bom: 'nav.production', scheduling: 'nav.production',
  labels: 'nav.production', drawings: 'nav.production',
  'sales-overview': 'nav.salesFinance', 'sales-parts': 'nav.salesFinance',
  'sales-customers': 'nav.salesFinance', 'sales-dates': 'nav.salesFinance',
  admin: 'admin.page', reports: 'nav.reports', quotes: 'nav.quotes',
}

export function BreadcrumbNav() {
  const { t } = useI18n()
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const pageKey = segments[segments.length - 1]
  const sectionKey = sectionKeys[pageKey]
  const label = pathLabelKeys[pageKey] ? t(pathLabelKeys[pageKey]) : pageKey

  return (
    <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
      <Link href="/" className="hover:text-foreground transition-colors">
        <Home className="size-3.5" />
      </Link>
      <ChevronRight className="size-3" />
      {sectionKey && (
        <>
          <span>{t(sectionKey)}</span>
          <ChevronRight className="size-3" />
        </>
      )}
      <span className="text-foreground font-medium">{label}</span>
    </nav>
  )
}
