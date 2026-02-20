'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { OrderCard } from '@/components/cards/OrderCard'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import PalletLoadCalculator from '@/components/PalletLoadCalculator'
import { OrderDetail } from '@/components/OrderDetail'
import type { Order } from '@/lib/google-sheets'
import { InventoryPopover } from '@/components/InventoryPopover'
import { normalizeStatus } from '@/lib/google-sheets'
import { useI18n } from '@/lib/i18n'

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
  const { t } = useI18n()
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
      key: 'priorityLevel',
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

      // Build pallet dimension/weight lookup by line number
      interface PalletRec { lineNumber: string; weight: string; dimensions: string }
      const palletRecs: PalletRec[] = palletRes.ok ? await palletRes.json() : []
      const palletByLine = new Map<string, { avgWeight: number; w: number; l: number }>()
      const grouped = new Map<string, PalletRec[]>()
      for (const pr of palletRecs) {
        if (!pr.lineNumber) continue
        const arr = grouped.get(pr.lineNumber) || []
        arr.push(pr)
        grouped.set(pr.lineNumber, arr)
      }
      for (const [line, recs] of grouped) {
        const totalW = recs.reduce((s, p) => s + (parseFloat(p.weight) || 0), 0)
        const avgWeight = recs.length > 0 ? Math.round(totalW / recs.length) : 0
        let w = 0, l = 0
        const firstDims = recs.find(p => p.dimensions)?.dimensions || ''
        if (firstDims) {
          const parts = firstDims.split(/x/i).map(s => parseFloat(s.trim()))
          if (parts.length >= 2) { w = parts[0] || 0; l = parts[1] || 0 }
        }
        palletByLine.set(line, { avgWeight, w, l })
      }

      // Enrich orders with pallet data
      const enrich = (o: Order): Order => {
        const pd = palletByLine.get(o.line)
        if (pd) {
          return { ...o, palletWidth: pd.w, palletLength: pd.l, palletWeightEach: pd.avgWeight }
        }
        return o
      }

      const staged = data.filter(
        (o) => normalizeStatus(o.internalStatus, o.ifStatus) === 'staged'
      ).map(enrich)
      setOrders(staged)
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
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
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
            getRowKey={(row) => getOrderKey(row as unknown as Order)}
            expandedRowKey={expandedOrderKey}
            onRowClick={(row) => toggleExpanded(row as unknown as Order)}
            renderExpandedContent={(row) => {
              const order = row as unknown as Order
              return (
                <OrderDetail
                  ifNumber={order.ifNumber}
                  line={order.line}
                  tirePartNum={order.tire}
                  hubPartNum={order.hub}
                  partNumber={order.partNumber}
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
                  statusOverride="Staged"
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
