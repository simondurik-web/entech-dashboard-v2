'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { RefreshCw, Truck } from 'lucide-react'
import { OrderCard } from '@/components/cards/OrderCard'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import PalletLoadCalculator from '@/components/PalletLoadCalculator'
import { OrderDetail } from '@/components/OrderDetail'
import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import type { Order } from '@/lib/google-sheets-shared'
import { InventoryPopover } from '@/components/InventoryPopover'
import { normalizeStatus } from '@/lib/google-sheets-shared'
import { useI18n } from '@/lib/i18n'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { getExtraOrderColumns } from '@/lib/extra-order-columns'
import { getEffectivePriority } from '@/lib/priority'
import { buildPalletEnrichmentByLine, applyPalletEnrichment } from '@/lib/pallet-enrichment'

type FilterKey = 'all' | 'rolltech' | 'molding' | 'snappad'
type OrderRow = Order & Record<string, unknown>

function priorityColor(priority: string): string {
  if (priority === 'P1') return 'bg-red-500/20 text-red-600'
  if (priority === 'P2') return 'bg-orange-500/20 text-orange-600'
  if (priority === 'P3') return 'bg-yellow-500/20 text-yellow-600'
  if (priority === 'P4') return 'bg-blue-500/20 text-blue-600'
  return 'bg-muted text-muted-foreground'
}

function filterOrders(orders: Order[], filter: FilterKey, search: string): Order[] {
  let result = orders
  switch (filter) {
    case 'rolltech':
      result = result.filter((o) => o.category.toLowerCase().includes('roll'))
      break
    case 'molding':
      result = result.filter((o) => o.category.toLowerCase().includes('molding'))
      break
    case 'snappad':
      result = result.filter((o) => o.category.toLowerCase().includes('snap'))
      break
  }
  if (search.trim()) {
    const q = search.toLowerCase()
    result = result.filter(
      (o) =>
        o.customer.toLowerCase().includes(q) ||
        o.partNumber.toLowerCase().includes(q) ||
        o.ifNumber.toLowerCase().includes(q) ||
        o.line.toLowerCase().includes(q)
    )
  }
  return result
}

export default function StagedPage() {
  return <Suspense><StagedPageContent /></Suspense>
}

function StagedPageContent() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const { canAccess, canAccessExact } = usePermissions()
  const canEditPallets = canAccess('edit_pallet_records')
  // "Ship Loads" action permission — page visibility alone doesn't ship
  const canShipLoads = canAccessExact('ship_loads')
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [orders, setOrders] = useState<Order[]>([])
  const [completedOrders, setCompletedOrders] = useState<Order[]>([])
  const [needToPackageOrders, setNeedToPackageOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)
  const [showPLC, setShowPLC] = useState(false)
  // Multi-line order context ("2 of 3 lines ready") keyed by ERP SO name.
  const [soLineStats, setSoLineStats] = useState<Record<string, { total: number; ready: number; shipped: number }>>({})

  const FILTERS = useMemo(() => [
    { key: 'all' as const, label: t('category.all') },
    { key: 'rolltech' as const, label: t('category.rollTech'), emoji: '🔵' },
    { key: 'molding' as const, label: t('category.molding'), emoji: '🟡' },
    { key: 'snappad' as const, label: t('category.snappad'), emoji: '🟣' },
  ], [t])

  const STAGED_COLUMNS: ColumnDef<OrderRow>[] = useMemo(() => [
    { key: 'line', label: t('table.line'), sortable: true },
    { key: 'ifNumber', label: t('table.ifNumber'), sortable: true },
    { key: 'poNumber', label: t('table.po'), sortable: true },
    {
      key: 'effectivePriority' as keyof (Order & Record<string, unknown>) & string,
      label: t('table.priority'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as Order
        const isUrgent = order.urgentOverride || (order.priorityLevel && order.priorityLevel >= 3)
        if (isUrgent) {
          return <span className="px-2 py-0.5 text-xs rounded font-bold bg-red-500 text-white">{t('priority.urgent')}</span>
        }
        const priority = v ? `P${v}` : 'P-'
        return <span className={`px-2 py-0.5 text-xs rounded font-semibold ${priorityColor(priority)}`}>{priority}</span>
      },
    },
    {
      key: 'daysUntilDue',
      label: t('staged.daysUntil'),
      sortable: true,
      render: (v) => {
        const days = v as number | null
        if (days === null) return '-'
        if (days < 0) return <span className="text-red-500 font-bold">{days}</span>
        if (days <= 3) return <span className="text-orange-500 font-semibold">{days}</span>
        return String(days)
      },
    },
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
    { key: 'orderQty', label: t('table.qty'), sortable: true, render: (v) => (v as number).toLocaleString() },
    {
      key: 'tire', label: t('table.tire'), sortable: true, filterable: true,
      render: (v) => {
        const val = String(v || '')
        if (!val || val === '-') return <span className="text-muted-foreground">-</span>
        return (
          <span className="inline-flex items-center gap-1">
            <span>{val}</span>
            <InventoryPopover partNumber={val} partType="tire" />
          </span>
        )
      },
    },
    {
      key: 'hub', label: t('table.hub'), sortable: true, filterable: true,
      render: (v) => {
        const val = String(v || '')
        if (!val || val === '-') return <span className="text-muted-foreground">-</span>
        return (
          <span className="inline-flex items-center gap-1">
            <span>{val}</span>
            <InventoryPopover partNumber={val} partType="hub" />
          </span>
        )
      },
    },
    { key: 'bearings', label: t('table.bearings'), sortable: true, filterable: true },
    // Extra columns — hidden by default
    ...getExtraOrderColumns<Order & Record<string, unknown>>(new Set([
      'line', 'ifNumber', 'poNumber', 'effectivePriority', 'daysUntilDue',
      'customer', 'partNumber', 'orderQty', 'tire', 'hub', 'bearings',
    ])),
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
      const [res, palletRes] = await Promise.all([
        fetch('/api/sheets'),
        fetch('/api/pallet-records'),
      ])
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data: Order[] = await res.json()

      // Build pallet enrichment by line (shared logic — keeps this page and the
      // shipping-overview calculator in lockstep).
      interface PalletRec { lineNumber: string; orderNumber?: string; weight: string; dimensions: string }
      const palletRecs: PalletRec[] = palletRes.ok ? await palletRes.json() : []
      const palletByLine = buildPalletEnrichmentByLine(
        palletRecs.map((pr) => ({
          line: (pr.lineNumber || '').trim() || (pr.orderNumber || '').trim(),
          dimensions: pr.dimensions || '',
          weight: parseFloat(pr.weight) || 0,
        })),
      )

      // Enrich orders with the real pallet count + records so the Pallet Load
      // Calculator reflects actual pallets, not the order's estimated numPackages.
      const enrich = (o: Order): Order => applyPalletEnrichment(o, palletByLine)

      // Per-SO line stats so a staged line of a multi-line order shows what
      // it's still waiting on (Simon 2026-07-03).
      const stats: Record<string, { total: number; ready: number; shipped: number }> = {}
      for (const o of data) {
        const key = (o.ifNumber || '').split(' ')[0]
        if (!/^(SO|SAL-ORD)-/.test(key)) continue
        const s = (stats[key] ??= { total: 0, ready: 0, shipped: 0 })
        s.total += 1
        const st = normalizeStatus(o.internalStatus, o.ifStatus)
        if (st === 'staged') s.ready += 1
        else if (st === 'shipped') s.shipped += 1
      }
      setSoLineStats(stats)

      const staged = data.filter(
        (o) => normalizeStatus(o.internalStatus, o.ifStatus) === 'staged'
      ).map(enrich)
      setOrders(staged.map(o => ({ ...o, effectivePriority: getEffectivePriority(o) || '-' })) as typeof staged)
      // Also store completed and need-to-package for pallet calculator planning
      setCompletedOrders(data.filter(
        (o) => normalizeStatus(o.internalStatus, o.ifStatus) === 'completed'
      ).map(enrich))
      setNeedToPackageOrders(data.filter(
        (o) => {
          const s = normalizeStatus(o.internalStatus, o.ifStatus)
          return s === 'wip' || s === 'pending'
        }
      ).map(enrich))
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

  const filtered = filterOrders(orders, filter, search) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: STAGED_COLUMNS,
    storageKey: 'staged',
  })

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t('page.staged')}</h1>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder={t('staged.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full p-3 mb-4 rounded-lg bg-muted border border-border"
      />

      {/* Filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in f ? `${f.emoji} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <TableSkeleton rows={8} />
      )}

      {/* Error */}
      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {/* Staged list with DataTable (table + card views) */}
      {!loading && !error && (
        <>
          <DataTable
            table={table}
            data={filtered}
            noun={t('staged.noun')}
            exportFilename="staged-orders.csv"
          page="staged"
          initialView={initialView}
          autoExport={autoExport}
            getRowKey={(row) => getOrderKey(row as unknown as Order)}
            expandedRowKey={expandedOrderKey}
            onRowClick={(row) => toggleExpanded(row as unknown as Order)}
            renderExpandedContent={(row) => {
              const order = row as unknown as Order
              // ERPNext SO name lives in ifNumber since the ERP cutover
              // ("SO-00043" or "SO-00043 (IF12345)"); legacy SAL-ORD names too.
              const soName = (order.ifNumber || '').split(' ')[0]
              const canShip = canShipLoads && /^(SO|SAL-ORD)-/.test(soName)
              const sib = soLineStats[soName]
              return (
                <div>
                  {canShip && (
                    <div className="px-3 pt-3 flex items-center gap-3">
                      <Link
                        href={`/staged/ship?so=${encodeURIComponent(soName)}`}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
                      >
                        <Truck className="size-4" />
                        {t('fulfillment.shipOrder')}
                      </Link>
                      {sib && sib.total > 1 && (
                        <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-600">
                          {t('fulfillment.linesReady')
                            .replace('{ready}', String(sib.ready + sib.shipped))
                            .replace('{total}', String(sib.total))}
                        </span>
                      )}
                    </div>
                  )}
                  <OrderDetail
                  ifNumber={order.ifNumber}
                  line={order.line}
                  tirePartNum={order.tire}
                  hubPartNum={order.hub}
                  partNumber={order.partNumber}
                  customer={order.customer}
                  poNumber={order.poNumber}
                  canEdit={canEditPallets}
                  userName={profile?.full_name || ''}
                  onClose={() => setExpandedOrderKey(null)}
                  />
                </div>
              )
            }}
            renderCard={(row, i) => {
              const order = row as unknown as Order
              const soName = (order.ifNumber || '').split(' ')[0]
              return (
                <OrderCard
                  order={order}
                  index={i}
                  isExpanded={expandedOrderKey === getOrderKey(order)}
                  onToggle={() => toggleExpanded(order)}
                  statusOverride="Staged"
                  expandedAction={
                    canShipLoads && /^(SO|SAL-ORD)-/.test(soName) ? (
                      <div className="mb-3">
                        <Link
                          href={`/staged/ship?so=${encodeURIComponent(soName)}`}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-colors"
                        >
                          <Truck className="size-4" />
                          {t('fulfillment.shipOrder')}
                        </Link>
                        {soLineStats[soName] && soLineStats[soName].total > 1 && (
                          <p className="mt-1.5 text-center text-xs font-semibold text-amber-600">
                            {t('fulfillment.linesReady')
                              .replace('{ready}', String(soLineStats[soName].ready + soLineStats[soName].shipped))
                              .replace('{total}', String(soLineStats[soName].total))}
                          </p>
                        )}
                      </div>
                    ) : null
                  }
                />
              )
            }}
          />
        </>
      )}
      {/* Pallet Load Calculator */}
      {!loading && !error && (
        <div className="mt-6">
          <button
            onClick={() => setShowPLC((v) => !v)}
            className="w-full py-3 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {t('staged.palletLoadCalc')} {showPLC ? '▲' : '▼'}
          </button>
          {showPLC && (
            <div className="mt-3">
              <PalletLoadCalculator stagedOrders={orders} completedOrders={completedOrders} needToPackageOrders={needToPackageOrders} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
