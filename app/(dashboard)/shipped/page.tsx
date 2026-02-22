'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { RefreshCw } from 'lucide-react'
import { DataTable } from '@/components/data-table'
import { OrderCard } from '@/components/cards/OrderCard'
import { OrderDetail } from '@/components/OrderDetail'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { InventoryPopover } from '@/components/InventoryPopover'
import { useI18n } from '@/lib/i18n'
import { useCountUp } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'
import type { Order } from '@/lib/google-sheets'
import { normalizeStatus } from '@/lib/google-sheets'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'

type DateKey = 'all' | '7' | '30' | '90'
type CategoryKey = 'all' | 'rolltech' | 'molding' | 'snappad'

type OrderRow = Order & Record<string, unknown>

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts.map(Number)
  return new Date(y, m - 1, d)
}

function filterByDate(orders: Order[], days: DateKey): Order[] {
  if (days === 'all') return orders
  const now = new Date()
  const cutoff = new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000)
  return orders.filter((o) => {
    const shipped = parseDate(o.shippedDate)
    return shipped && shipped >= cutoff
  })
}

function filterByCategory(orders: Order[], filter: CategoryKey): Order[] {
  switch (filter) {
    case 'rolltech':
      return orders.filter((o) => o.category.toLowerCase().includes('roll'))
    case 'molding':
      return orders.filter((o) => o.category.toLowerCase().includes('molding'))
    case 'snappad':
      return orders.filter((o) => o.category.toLowerCase().includes('snap'))
    default:
      return orders
  }
}

export default function ShippedPage() {
  return <Suspense><ShippedPageContent /></Suspense>
}

function ShippedPageContent() {
  const [orders, setOrders] = useState<Order[]>([])
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateKey>('30')
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)

  const { t } = useI18n()

  const DATE_FILTERS = useMemo(() => [
    { key: 'all' as const, label: t('ui.allTime') },
    { key: '7' as const, label: t('ui.last7Days') },
    { key: '30' as const, label: t('ui.last30Days') },
    { key: '90' as const, label: t('ui.last90Days') },
  ], [t])

  const CATEGORY_FILTERS = useMemo(() => [
    { key: 'all' as const, label: t('category.all') },
    { key: 'rolltech' as const, label: t('category.rollTech'), emoji: '🔵' },
    { key: 'molding' as const, label: t('category.molding'), emoji: '🟡' },
    { key: 'snappad' as const, label: t('category.snappad'), emoji: '🟣' },
  ], [t])

  const COLUMNS: ColumnDef<OrderRow>[] = useMemo(() => [
    { key: 'shippedDate', label: t('table.shipDate'), sortable: true },
    { key: 'customer', label: t('table.customer'), sortable: true, filterable: true },
    {
      key: 'partNumber', label: t('table.partNumber'), sortable: true, filterable: true,
      render: (v) => (
        <span className="inline-flex items-center gap-1">
          <span className="font-bold">{String(v)}</span>
          <InventoryPopover partNumber={String(v)} partType="part" />
        </span>
      ),
    },
    { key: 'category', label: t('table.category'), sortable: true, filterable: true },
    { key: 'orderQty', label: t('table.qty'), sortable: true, render: (v) => (v as number).toLocaleString() },
    { key: 'line', label: t('table.line'), sortable: true },
    { key: 'ifNumber', label: t('table.ifNumber'), sortable: true },
    { key: 'poNumber', label: t('table.poNumber') },
  ], [t])

  const getOrderKey = (order: Order): string => `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`

  const toggleExpanded = (order: Order) => {
    const key = getOrderKey(order)
    setExpandedOrderKey((prev) => (prev === key ? null : key))
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/sheets')
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data: Order[] = await res.json()
      // Filter to shipped orders, sort by ship date descending
      const shipped = data
        .filter((o) => normalizeStatus(o.internalStatus, o.ifStatus) === 'shipped' || o.shippedDate)
        .sort((a, b) => {
          const dateA = parseDate(a.shippedDate)
          const dateB = parseDate(b.shippedDate)
          if (!dateA && !dateB) return 0
          if (!dateA) return 1
          if (!dateB) return -1
          return dateB.getTime() - dateA.getTime()
        })
      setOrders(shipped)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filtered = filterByCategory(filterByDate(orders, dateFilter), categoryFilter) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'shipped',
  })

  // Stats
  const totalShipped = filtered.length
  const totalUnits = filtered.reduce((sum, o) => sum + o.orderQty, 0)
  const animTotalShipped = useCountUp(totalShipped)
  const animTotalUnits = useCountUp(totalUnits)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">🚚 {t('page.shipped')}</h1>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">{t('page.shippedSubtitle')}</p>

      {/* Stats row */}
      <ScrollReveal>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <SpotlightCard className="bg-green-500/10 rounded-lg p-3" spotlightColor="34,197,94">
          <p className="text-xs text-green-600">{t('stats.totalShipments')}</p>
          <p className="text-xl font-bold text-green-600">{animTotalShipped}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-muted rounded-lg p-3" spotlightColor="148,163,184">
          <p className="text-xs text-muted-foreground">{t('stats.totalUnitsLabel')}</p>
          <p className="text-xl font-bold">{animTotalUnits.toLocaleString()}</p>
        </SpotlightCard>
      </div>
      </ScrollReveal>

      {/* Date range filter */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {DATE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDateFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              dateFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCategoryFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === f.key
                ? 'bg-green-600 text-white'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in f ? `${f.emoji} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <TableSkeleton rows={8} />
      )}

      {/* Error state */}
      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {/* Data table */}
      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun="shipment"
          exportFilename="shipped.csv"
          page="shipped"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => getOrderKey(row as unknown as Order)}
          expandedRowKey={expandedOrderKey}
          onRowClick={(row) => toggleExpanded(row as unknown as Order)}
          renderExpandedContent={(row) => {
            const order = row as unknown as Order
            return (
              <OrderDetail
                ifNumber={order.ifNumber}
                line={order.line}
                isShipped={true}
                shippedDate={order.shippedDate}
                partNumber={order.partNumber}
                tirePartNum={order.tire}
                hubPartNum={order.hub}
                onClose={() => setExpandedOrderKey(null)}
              />
            )
          }}
          renderCard={(row, i) => {
            const order = row as unknown as Order
            return (
              <OrderCard
                order={order}
                index={i}
                isExpanded={expandedOrderKey === getOrderKey(order)}
                onToggle={() => toggleExpanded(order)}
                statusOverride="Shipped"
                showShipDate
              />
            )
          }}
        />
      )}
    </div>
  )
}
