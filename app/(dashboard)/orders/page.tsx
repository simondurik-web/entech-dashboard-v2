'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { OrderDetail } from '@/components/OrderDetail'
import { AutoRefreshControl } from '@/components/ui/AutoRefreshControl'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { OrderCard } from '@/components/cards/OrderCard'
import { PageSkeleton } from '@/components/ui/skeleton-loader'
import { InventoryPopover } from '@/components/InventoryPopover'
import { useI18n } from '@/lib/i18n'
import type { Order } from '@/lib/google-sheets-shared'
import { normalizeStatus } from '@/lib/google-sheets-shared'
import { usePermissions } from '@/lib/use-permissions'
import { useAuth } from '@/lib/auth-context'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { useCountUp } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'
import { getEffectivePriority, type PriorityValue } from '@/lib/priority'
import { PriorityOverride } from '@/components/PriorityOverride'
import { getExtraOrderColumns } from '@/lib/extra-order-columns'
import { AssigneeEditor } from '@/components/AssigneeEditor'
import { LabelPreviewModal } from '@/components/labels/LabelPreviewModal'
import type { LabelData } from '@/lib/label-utils'
import { Tag } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { ProgressBar } from '@/components/ui/progress-bar'
import { DataFreshness } from '@/components/ui/data-freshness'

const CATEGORY_KEYS = ['all', 'rolltech', 'molding', 'snappad'] as const
const CATEGORY_EMOJIS: Record<string, string> = {
  rolltech: '🔵',
  molding: '🟡',
  snappad: '🟣',
}
const CATEGORY_I18N: Record<string, string> = {
  all: 'category.all',
  rolltech: 'category.rollTech',
  molding: 'category.molding',
  snappad: 'category.snappad',
}

const STATUS_KEYS = ['pending', 'wip', 'completed', 'staged', 'shipped'] as const
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500',
  wip: 'bg-teal-500',
  completed: 'bg-emerald-500',
  staged: 'bg-green-500',
  shipped: 'bg-gray-500',
}
const STATUS_I18N: Record<string, string> = {
  pending: 'status.pending',
  wip: 'status.wip',
  completed: 'status.completed',
  staged: 'status.readyToShip',
  shipped: 'status.shipped',
}

type CategoryKey = (typeof CATEGORY_KEYS)[number]
type StatusKey = (typeof STATUS_KEYS)[number]

type OrderRow = Order & Record<string, unknown>

function statusDisplayLabel(status: string, t: (key: string) => string): string {
  const s = status.toLowerCase()
  if (s === 'staged' || s === 'ready to ship') return t('status.readyToShip')
  if (s === 'work in progress' || s === 'wip' || s === 'released' || s === 'in production') return t('status.wip')
  if (s === 'pending' || s === 'need to make' || s === 'approved') return t('status.pending')
  if (s === 'completed') return t('status.completed')
  if (s === 'shipped' || s === 'invoiced' || s === 'to bill') return t('status.shipped')
  if (s === 'cancelled') return t('status.cancelled')
  return status || t('ui.na')
}

function isActiveStatus(order: Order): boolean {
  const s = normalizeStatus(order.internalStatus, order.ifStatus)
  return s === 'pending' || s === 'wip' || s === 'completed'
}

function priorityColor(priority: string): string {
  if (priority === 'P1') return 'bg-red-500/20 text-red-600'
  if (priority === 'P2') return 'bg-orange-500/20 text-orange-600'
  if (priority === 'P3') return 'bg-yellow-500/20 text-yellow-600'
  if (priority === 'P4') return 'bg-blue-500/20 text-blue-600'
  return 'bg-muted text-muted-foreground'
}

function statusColor(status: string): string {
  const s = status.toLowerCase()
  // Shipped/Invoiced - Blue
  if (s === 'shipped' || s === 'invoiced' || s === 'to bill') return 'bg-blue-500/20 text-blue-600'
  // Completed - Emerald
  if (s === 'completed') return 'bg-emerald-500/20 text-emerald-600'
  // Staged/Ready to Ship - Green
  if (s === 'staged' || s === 'ready to ship') return 'bg-green-500/20 text-green-600'
  // WIP/Making - Teal
  if (s === 'wip' || s === 'work in progress' || s === 'making' || s === 'released' || s === 'in production') return 'bg-teal-500/20 text-teal-600'
  // Pending/Need to Make - Yellow
  if (s === 'pending' || s === 'need to make' || s === 'approved') return 'bg-yellow-500/20 text-yellow-600'
  // Cancelled - Red
  if (s === 'cancelled') return 'bg-red-500/20 text-red-600'
  return 'bg-muted text-muted-foreground'
}

function borderColor(order: Order): string {
  const eff = getEffectivePriority(order)
  if (eff === 'URGENT' || eff === 'P1') return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue < 0) return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue <= 3) return 'border-l-orange-500'
  if (order.internalStatus.toLowerCase() === 'shipped') return 'border-l-green-500'
  if (order.internalStatus.toLowerCase() === 'staged') return 'border-l-green-500'
  return 'border-l-blue-500'
}

function getOrderStatus(order: Order): StatusKey | null {
  const status = normalizeStatus(order.internalStatus, order.ifStatus)
  if (status === 'cancelled') return null // Filter out cancelled
  if (status === 'shipped' || order.shippedDate) return 'shipped'
  if (status === 'staged') return 'staged'
  if (status === 'completed') return 'completed'
  if (status === 'wip') return 'wip'
  if (status === 'pending') return 'pending'
  return 'pending'
}

function filterByCategory(orders: Order[], filter: CategoryKey): Order[] {
  if (filter === 'all') return orders
  return orders.filter((o) => {
    const cat = o.category.toLowerCase()
    switch (filter) {
      case 'rolltech':
        return cat.includes('roll')
      case 'molding':
        return cat.includes('molding')
      case 'snappad':
        return cat.includes('snap')
      default:
        return true
    }
  })
}

function filterByStatus(orders: Order[], activeStatuses: Set<StatusKey>): Order[] {
  if (activeStatuses.size === 0) return orders
  return orders.filter((o) => {
    const status = getOrderStatus(o)
    return status && activeStatuses.has(status)
  })
}

export default function OrdersPage() {
  return <Suspense><OrdersPageContent /></Suspense>
}

function OrdersPageContent() {
  const { t } = useI18n()
  const { user, profile } = useAuth()
  const { canAccess } = usePermissions()
  const canEditPallets = canAccess('edit_pallet_records')
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')
  const [activeStatuses, setActiveStatuses] = useState<Set<StatusKey>>(
    new Set(['pending', 'wip', 'completed', 'staged'])
  )
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)
  const [labelPreview, setLabelPreview] = useState<LabelData | null>(null)
  const [allLabelsForOrder, setAllLabelsForOrder] = useState<LabelData[]>([])
  const [showLabelPreview, setShowLabelPreview] = useState(false)
  const [labelWarning, setLabelWarning] = useState<string | null>(null)

  // Optimistic priority update handler
  const handlePriorityUpdate = useCallback((line: string, newPriority: PriorityValue) => {
    setOrders(prev => prev.map(o => {
      if (o.line !== line) return o
      const updated = {
        ...o,
        priorityOverride: newPriority,
        priorityChangedAt: new Date().toISOString(),
      }
      return { ...updated, effectivePriority: getEffectivePriority(updated) || '-' }
    }))
  }, [])

  const handleAssigneeUpdate = useCallback((line: string, newAssignee: string) => {
    setOrders(prev => prev.map(o =>
      o.line === line ? { ...o, assignedTo: newAssignee } : o
    ))
  }, [])

  const handleLabelClick = useCallback(async (order: Order) => {
    setLabelWarning(null)
    try {
      const res = await fetch(`/api/labels?order_line=${encodeURIComponent(order.line)}`)
      const existing = await res.json()
      if (Array.isArray(existing) && existing.length > 0) {
        setLabelPreview(existing[0])
        setAllLabelsForOrder(existing)
        setShowLabelPreview(true)
      } else {
        const genRes = await fetch('/api/labels', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(user ? { 'x-user-id': user.id } : {}),
          },
          body: JSON.stringify({ order_lines: [order.line] }),
        })
        const genData = await genRes.json()
        const result = genData.results?.[0]
        if (result?.error) { setLabelWarning(result.error); return }
        if (result?.labels?.[0]) {
          setLabelPreview(result.labels[0])
          setAllLabelsForOrder(result.labels)
          setShowLabelPreview(true)
        }
      }
    } catch (e) { setLabelWarning((e as Error).message) }
  }, [user])

  const showLabels = canAccess('/labels')
  const canAssign = canAccess('assign_orders')

  const defaultColumnKeys = useMemo(() => new Set([
    'line', 'ifNumber', 'poNumber', 'effectivePriority', 'dateOfRequest', 'requestedDate',
    'daysUntilDue', 'customer', 'partNumber', 'orderQty', 'tire', 'hub', 'bearings',
    'internalStatus', 'category', 'assignedTo',
  ]), [])

  const ORDER_COLUMNS: ColumnDef<OrderRow>[] = useMemo(() => [
    { key: 'line', label: t('table.line'), sortable: true },
    { key: 'ifNumber', label: t('table.ifNumber'), sortable: true },
    { key: 'poNumber', label: t('table.po'), sortable: true },
    {
      key: 'effectivePriority' as keyof OrderRow & string,
      label: t('table.priority'),
      sortable: true,
      filterable: true,
      render: (_v, row) => {
        const order = row as unknown as Order
        const effective = getEffectivePriority(order)
        const isOverridden = !!order.priorityOverride

        if (!effective) {
          return (
            <span className="inline-flex items-center">
              <span className="text-muted-foreground text-xs">-</span>
              <PriorityOverride
                line={order.line}
                currentPriority={null}
                isOverridden={false}
                onUpdate={handlePriorityUpdate}
              />
            </span>
          )
        }

        if (effective === 'URGENT') {
          return (
            <span className="inline-flex items-center">
              <span className="px-2 py-0.5 text-xs rounded font-bold bg-red-500 text-white">{t('priority.urgent')}</span>
              <PriorityOverride
                line={order.line}
                currentPriority="URGENT"
                isOverridden={isOverridden}
                onUpdate={handlePriorityUpdate}
              />
            </span>
          )
        }

        return (
          <span className="inline-flex items-center">
            <span className={`px-2 py-0.5 text-xs rounded font-semibold ${priorityColor(effective)}`}>{effective}</span>
            <PriorityOverride
              line={order.line}
              currentPriority={effective}
              isOverridden={isOverridden}
              onUpdate={handlePriorityUpdate}
            />
          </span>
        )
      },
    },
    {
      key: 'dateOfRequest',
      label: 'Requested',
      sortable: true,
      render: (v) => {
        const d = v as string
        if (!d) return '-'
        return <span className="text-xs whitespace-nowrap">{d}</span>
      },
    },
    {
      key: 'requestedDate',
      label: 'Due Date',
      sortable: true,
      render: (v) => {
        const d = v as string
        if (!d) return '-'
        return <span className="text-xs whitespace-nowrap">{d}</span>
      },
    },
    {
      key: 'daysUntilDue',
      label: t('table.daysUntil'),
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
      key: 'partNumber',
      label: t('table.partNumber'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as Order
        const cat = order.category.toLowerCase()
        const active = isActiveStatus(order)
        const colorClass = active && (cat.includes('molding') || cat.includes('snap'))
          ? (order.fusionInventory >= order.orderQty ? 'text-green-500' : 'text-red-400 font-black')
          : ''
        return (
          <span className="inline-flex items-center gap-1">
            <strong className={colorClass}>{String(v)}</strong>
            <InventoryPopover partNumber={String(v)} partType="part" />
          </span>
        )
      },
    },
    { key: 'orderQty', label: t('table.qty'), sortable: true, render: (v) => (v as number).toLocaleString() },
    {
      key: 'tire',
      label: t('table.tire'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as Order
        const isRollTech = order.category.toLowerCase().includes('roll')
        if (!isRollTech) return <span className="text-muted-foreground">{t('ui.na')}</span>
        const val = String(v || '')
        if (!val || val === '-') return <span className="text-muted-foreground">-</span>
        const active = isActiveStatus(order)
        const colorClass = active ? (order.hasTire ? 'text-green-500' : 'text-red-400 font-bold') : ''
        return (
          <span className="inline-flex items-center gap-1">
            <span className={colorClass}>{val}</span>
            <InventoryPopover partNumber={val} partType="tire" />
          </span>
        )
      },
    },
    {
      key: 'hub',
      label: t('table.hub'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as Order
        const isRollTech = order.category.toLowerCase().includes('roll')
        if (!isRollTech) return <span className="text-muted-foreground">{t('ui.na')}</span>
        const val = String(v || '')
        if (!val || val === '-') return <span className="text-muted-foreground">-</span>
        const active = isActiveStatus(order)
        const colorClass = active ? (order.hasHub ? 'text-green-500' : 'text-red-400 font-bold') : ''
        return (
          <span className="inline-flex items-center gap-1">
            <span className={colorClass}>{val}</span>
            <InventoryPopover partNumber={val} partType="hub" />
          </span>
        )
      },
    },
    { key: 'bearings', label: t('table.bearings'), sortable: true, filterable: true },
    {
      key: 'internalStatus',
      label: t('table.status'),
      sortable: true,
      filterable: true,
      render: (v) => {
        const status = String(v || '')
        const displayLabel = statusDisplayLabel(status, t)
        const normalized = normalizeStatus(status, '')
        return (
          <StatusBadge status={normalized} label={displayLabel || t('ui.na')} />
        )
      },
    },
    { key: 'category', label: t('table.category'), sortable: true, filterable: true },
    {
      key: 'assignedTo',
      label: t('table.assignedTo'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as Order
        if (canAssign) {
          return (
            <AssigneeEditor
              line={order.line}
              currentAssignee={String(v || '')}
              onUpdated={handleAssigneeUpdate}
            />
          )
        }
        return String(v || '')
      },
    },
    // Label button column
    ...(showLabels ? [{
      key: 'labelAction' as keyof OrderRow & string,
      label: '🏷️',
      render: (_v: OrderRow[keyof OrderRow], row: OrderRow) => {
        const order = row as unknown as Order
        return (
          <button
            onClick={(e) => { e.stopPropagation(); handleLabelClick(order) }}
            className="rounded p-1 hover:bg-muted transition-colors"
            title="Label"
          >
            <Tag className="size-4" />
          </button>
        )
      },
    }] as ColumnDef<OrderRow>[] : []),
    // Extra columns — hidden by default, available via Columns picker
    ...getExtraOrderColumns<OrderRow>(defaultColumnKeys),
  ], [t, defaultColumnKeys, canAssign, handleAssigneeUpdate, showLabels, handleLabelClick])

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/sheets')
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data: Order[] = await res.json()
      // Add effectivePriority for filtering/display
      const enriched = data.map(o => ({ ...o, effectivePriority: getEffectivePriority(o) || '-' }))
      setOrders(enriched as Order[])
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

  // Auto-refresh every 5 minutes
  const autoRefresh = useAutoRefresh({
    interval: 5 * 60 * 1000,
    onRefresh: () => fetchData(true),
  })

  const toggleStatus = (status: StatusKey) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  const getOrderKey = (order: Order): string => `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`

  const toggleExpanded = (order: Order) => {
    const key = getOrderKey(order)
    setExpandedOrderKey((prev) => (prev === key ? null : key))
  }

  const filtered = filterByStatus(filterByCategory(orders, categoryFilter), activeStatuses) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: ORDER_COLUMNS,
    storageKey: 'orders',
  })

  // Stats
  const totalOrders = filtered.length
  const totalUnits = filtered.reduce((sum, o) => sum + o.orderQty, 0)
  const needToMake = orders.filter((o) => getOrderStatus(o) === 'pending').length
  const making = orders.filter((o) => getOrderStatus(o) === 'wip').length
  const completed = orders.filter((o) => getOrderStatus(o) === 'completed').length
  const readyToShip = orders.filter((o) => getOrderStatus(o) === 'staged').length

  const animTotalOrders = useCountUp(totalOrders)
  const animNeedToMake = useCountUp(needToMake)
  const animMaking = useCountUp(making)
  const animCompleted = useCountUp(completed)
  const animReadyToShip = useCountUp(readyToShip)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📋 {t('page.ordersData')}</h1>
        <div className="flex items-center gap-2">
          <DataFreshness lastUpdated={autoRefresh.lastRefresh} />
          <AutoRefreshControl
            isEnabled={autoRefresh.isAutoRefreshEnabled}
            onToggle={autoRefresh.toggleAutoRefresh}
            onRefreshNow={() => fetchData(true)}
            isRefreshing={refreshing}
            nextRefresh={autoRefresh.nextRefresh}
            lastRefresh={autoRefresh.lastRefresh}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm mb-4">{t('page.ordersSubtitle')}</p>

      {/* Stats row */}
      <ScrollReveal>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        <SpotlightCard className="bg-muted rounded-lg p-3 stat-card-hover" spotlightColor="148,163,184">
          <p className="text-xs text-muted-foreground">{t('stats.totalOrders')}</p>
          <p className="text-xl font-bold">{animTotalOrders}</p>
          <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString()} {t('stats.totalUnits')}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-yellow-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-amber" spotlightColor="234,179,8">
          <p className="text-xs text-yellow-600">{t('stats.pending')}</p>
          <p className="text-xl font-bold text-yellow-600">{animNeedToMake}</p>
          <ProgressBar value={totalOrders > 0 ? (needToMake / totalOrders) * 100 : 0} color="bg-yellow-500" className="mt-2" />
        </SpotlightCard>
        <SpotlightCard className="bg-teal-500/10 rounded-lg p-3 stat-card-hover" spotlightColor="20,184,166">
          <p className="text-xs text-teal-600">{t('stats.wip')}</p>
          <p className="text-xl font-bold text-teal-600">{animMaking}</p>
          <ProgressBar value={totalOrders > 0 ? (making / totalOrders) * 100 : 0} color="bg-teal-500" className="mt-2" />
        </SpotlightCard>
        <SpotlightCard className="bg-emerald-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-green" spotlightColor="16,185,129">
          <p className="text-xs text-emerald-600">{t('stats.completed')}</p>
          <p className="text-xl font-bold text-emerald-600">{animCompleted}</p>
          <ProgressBar value={totalOrders > 0 ? (completed / totalOrders) * 100 : 0} color="bg-emerald-500" className="mt-2" />
        </SpotlightCard>
        <SpotlightCard className="bg-green-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-green" spotlightColor="34,197,94">
          <p className="text-xs text-green-600">{t('stats.readyToShip')}</p>
          <p className="text-xl font-bold text-green-600">{animReadyToShip}</p>
          <ProgressBar value={totalOrders > 0 ? (readyToShip / totalOrders) * 100 : 0} color="bg-green-500" className="mt-2" />
        </SpotlightCard>
      </div>
      </ScrollReveal>

      {/* Category filters */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {CATEGORY_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setCategoryFilter(key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {CATEGORY_EMOJIS[key] ? `${CATEGORY_EMOJIS[key]} ` : ''}{t(CATEGORY_I18N[key])}
          </button>
        ))}
      </div>

      {/* Status filters (toggleable) */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <span className="text-xs text-muted-foreground self-center mr-1">{t('ui.status')}:</span>
        {STATUS_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => toggleStatus(key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              activeStatuses.has(key)
                ? `${STATUS_COLORS[key]} text-white`
                : 'bg-muted hover:bg-muted/80 opacity-50'
            }`}
          >
            {t(STATUS_I18N[key])}
          </button>
        ))}
      </div>

      {/* Loading state — shimmer skeletons */}
      {loading && (
        <PageSkeleton statCards={0} tableRows={10} />
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
          noun={t('orders.noun')}
          exportFilename="orders.csv"
          page="orders"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => getOrderKey(row as unknown as Order)}
          rowClassName={(row) => {
            const order = row as unknown as Order
            const s = normalizeStatus(order.internalStatus, order.ifStatus)
            return `row-status-${s}`
          }}
          expandedRowKey={expandedOrderKey}
          onRowClick={(row) => toggleExpanded(row as unknown as Order)}
          renderExpandedContent={(row) => {
            const order = row as unknown as Order
            return (
              <OrderDetail
                ifNumber={order.ifNumber}
                line={order.line}
                isShipped={getOrderStatus(order) === 'shipped'}
                shippedDate={order.shippedDate}
                partNumber={order.partNumber}
                tirePartNum={order.tire}
                hubPartNum={order.hub}
                canEdit={canEditPallets}
                userName={profile?.full_name || ''}
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
              />
            )
          }}
        />
      )}

      {/* Label warning */}
      {labelWarning && (
        <div className="fixed bottom-4 right-4 z-50 bg-destructive text-destructive-foreground px-4 py-2 rounded-lg shadow-lg max-w-sm">
          <p className="text-sm">{labelWarning}</p>
          <button className="text-xs underline mt-1" onClick={() => setLabelWarning(null)}>Dismiss</button>
        </div>
      )}

      {/* Label preview modal */}
      {labelPreview && (
        <LabelPreviewModal
          label={labelPreview}
          siblingLabels={allLabelsForOrder}
          open={showLabelPreview}
          onOpenChange={(open) => {
            setShowLabelPreview(open)
            if (!open) setLabelPreview(null)
          }}
          onPrint={(label) => {
            if (label.id && user) {
              fetch(`/api/labels/${label.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
                body: JSON.stringify({
                  label_status: 'printed',
                  printed_by_name: profile?.full_name || user.email || 'Unknown',
                }),
              })
            }
          }}
        />
      )}
    </div>
  )
}
