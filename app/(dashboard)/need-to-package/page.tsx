'use client'

import { Suspense, useEffect, useState, useMemo } from 'react'
import { DataTable } from '@/components/data-table'
import { OrderDetail } from '@/components/OrderDetail'
import { OrderCard } from '@/components/cards/OrderCard'
import { InventoryPopover } from '@/components/InventoryPopover'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order, InventoryItem } from '@/lib/google-sheets'
import { normalizeStatus } from '@/lib/google-sheets'
import { useI18n } from '@/lib/i18n'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'

type FilterKey = 'all' | 'rolltech' | 'molding' | 'snappad'

interface PackageOrder extends Order {
  availableStock: number
  canPackage: boolean
  hasTire: boolean
  hasHub: boolean
}

type PackageRow = PackageOrder & Record<string, unknown>

function PriorityBadge({ level, urgent }: { level: number; urgent: boolean }) {
  if (urgent) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white">URGENT</span>
  if (level >= 4) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-orange-500 text-white">P{level}</span>
  if (level >= 2) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-500 text-black">P{level}</span>
  if (level >= 1) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-500 text-white">P{level}</span>
  return <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">-</span>
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const s = status.toLowerCase()
  if (s.includes('need') || s.includes('pending')) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-yellow-500 text-black">{t('status.needToMake').toUpperCase()}</span>
  if (s.includes('making') || s.includes('wip') || s.includes('progress')) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-500 text-white">{t('status.making').toUpperCase()}</span>
  if (s.includes('staged') || s.includes('ready')) return <span className="px-2 py-0.5 rounded text-xs font-bold bg-green-600 text-white">{t('status.readyToShip').toUpperCase()}</span>
  return <span className="px-2 py-0.5 rounded text-xs bg-muted">{status}</span>
}

/** Category sort order: Roll Tech = 0, Molding = 1, Snap Pad = 2 */
function categoryOrder(cat: string): number {
  const c = cat.toLowerCase()
  if (c.includes('roll')) return 0
  if (c.includes('molding')) return 1
  if (c.includes('snap')) return 2
  return 3
}

function isRollTech(cat: string): boolean {
  return cat.toLowerCase().includes('roll')
}

function getColumns(t: (key: string) => string): ColumnDef<PackageRow>[] {
  return [
    { key: 'category', label: t('table.category'), sortable: true, filterable: true },
    {
      key: 'dateOfRequest',
      label: t('table.dueDate'),
      sortable: true,
      render: (v) => String(v || '-'),
    },
    {
      key: 'priorityLevel',
      label: t('table.priority'),
      sortable: true,
      filterable: true,
      render: (v, row) => <PriorityBadge level={v as number} urgent={(row as unknown as PackageOrder).urgentOverride} />,
    },
    { key: 'line', label: t('table.line'), sortable: true, filterable: true },
    { key: 'customer', label: t('table.customer'), sortable: true, filterable: true },
    { key: 'ifNumber', label: t('table.ifNumber'), sortable: true, filterable: true },
    {
      key: 'partNumber',
      label: t('table.partNumber'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as PackageOrder
        const colorClass = isRollTech(order.category) ? '' : (order.fusionInventory >= order.orderQty ? 'text-green-500 font-semibold' : 'text-red-400 font-bold')
        return (
          <span className="inline-flex items-center gap-1">
            <span className={colorClass}>{String(v)}</span>
            <InventoryPopover partNumber={String(v)} partType="part" />
          </span>
        )
      },
    },
    {
      key: 'numPackages',
      label: t('table.packages'),
      sortable: true,
      render: (v) => { const n = v as number; return n > 0 ? Math.ceil(n).toString() : '-' },
    },
    { key: 'packaging', label: t('table.packaging'), sortable: true, filterable: true },
    {
      key: 'partsPerPackage',
      label: t('table.partPerPackage'),
      sortable: true,
      render: (v) => { const n = v as number; return n > 0 ? n.toLocaleString() : '-' },
    },
    { key: 'orderQty', label: t('table.qty'), sortable: true, render: (v) => (v as number).toLocaleString() },
    {
      key: 'fusionInventory',
      label: t('table.fusionInv'),
      sortable: true,
      render: (v) => {
        const n = v as number
        // Always white/default -- no color coding on this column
        return <span>{n > 0 ? n.toLocaleString() : '0'}</span>
      },
    },
    {
      key: 'tire',
      label: t('table.tire'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as PackageOrder
        if (!isRollTech(order.category)) return <span className="text-muted-foreground">-</span>
        const tire = String(v || '')
        if (!tire || tire === '-') return <span className="text-muted-foreground">-</span>
        return (
          <span className="inline-flex items-center gap-1">
            <span className={order.hasTire ? 'text-green-500 font-semibold' : 'text-red-400 font-bold'}>{tire}</span>
            <InventoryPopover partNumber={tire} partType="tire" />
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
        const order = row as unknown as PackageOrder
        if (!isRollTech(order.category)) return <span className="text-muted-foreground">-</span>
        const hub = String(v || '')
        if (!hub || hub === '-') return <span className="text-muted-foreground">-</span>
        return (
          <span className="inline-flex items-center gap-1">
            <span className={order.hasHub ? 'text-green-500 font-semibold' : 'text-red-400 font-bold'}>{hub}</span>
            <InventoryPopover partNumber={hub} partType="hub" />
          </span>
        )
      },
    },
    { key: 'hubMold', label: t('table.hubMold'), sortable: true, filterable: true },
    { key: 'bearings', label: t('table.bearings'), sortable: true, filterable: true },
    { key: 'assignedTo', label: t('table.assignedTo'), sortable: true, filterable: true },
    {
      key: 'internalStatus',
      label: t('table.status'),
      sortable: true,
      filterable: true,
      render: (v) => <StatusBadge status={String(v || '')} t={t} />,
    },
    {
      key: 'daysUntilDue',
      label: t('table.daysUntil'),
      sortable: true,
      render: (v) => {
        const days = v as number | null
        if (days === null) return '-'
        if (days < 0) return <span className="text-red-500 font-semibold">{t('needToPackage.overdue')}</span>
        if (days <= 3) return <span className="text-orange-500 font-semibold">{days}d</span>
        return `${days}d`
      },
    },
  ]
}

function filterByCategory(orders: PackageOrder[], filter: FilterKey): PackageOrder[] {
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

export default function NeedToPackagePage() {
  return <Suspense><NeedToPackagePageContent /></Suspense>
}

function NeedToPackagePageContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [orders, setOrders] = useState<PackageOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)

  const FILTERS = useMemo(() => [
    { key: 'all' as const, label: t('category.all') },
    { key: 'rolltech' as const, label: t('category.rollTech'), emoji: '🔵' },
    { key: 'molding' as const, label: t('category.molding'), emoji: '🟡' },
    { key: 'snappad' as const, label: t('category.snappad'), emoji: '🟣' },
  ], [t])

  const columns = useMemo(() => getColumns(t), [t])

  const getOrderKey = (order: Order): string => `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`

  const toggleExpanded = (order: Order) => {
    const key = getOrderKey(order)
    setExpandedOrderKey((prev) => (prev === key ? null : key))
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/sheets').then((res) => res.json()),
      fetch('/api/inventory').then((res) => res.json()),
    ])
      .then(([ordersData, inventoryData]: [Order[], InventoryItem[]]) => {
        const stockMap = new Map<string, number>()
        inventoryData.forEach((item) => {
          stockMap.set(item.partNumber.toUpperCase(), item.inStock)
        })

        const needToPackage = ordersData
          .filter((o) => {
            const status = normalizeStatus(o.internalStatus, o.ifStatus)
            return (status === 'pending' || status === 'wip') && !o.shippedDate
          })
          .map((o): PackageOrder => {
            const stock = stockMap.get(o.partNumber.toUpperCase()) ?? 0
            return {
              ...o,
              availableStock: stock,
              canPackage: stock >= o.orderQty,
            }
          })
          // Sort: category (RT->Molding->SnapPad), then urgent first, then priority P1->P4, then due date
          .sort((a, b) => {
            // 1. Category group
            const catDiff = categoryOrder(a.category) - categoryOrder(b.category)
            if (catDiff !== 0) return catDiff
            // 2. Urgent always on top
            if (a.urgentOverride && !b.urgentOverride) return -1
            if (!a.urgentOverride && b.urgentOverride) return 1
            // 3. Priority (lower number = higher priority, P1 before P4)
            const aPri = a.priorityLevel || 99
            const bPri = b.priorityLevel || 99
            if (aPri !== bPri) return aPri - bPri
            // 4. Due date (earlier = higher)
            return (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999)
          })

        setOrders(needToPackage)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByCategory(orders, filter) as PackageRow[]

  const table = useDataTable({
    data: filtered,
    columns,
    storageKey: 'need-to-package',
  })

  // Stats
  const totalOrders = filtered.length
  const readyCount = filtered.filter((o) => o.canPackage).length
  const missingCount = filtered.filter((o) => !o.canPackage).length
  const urgentReady = filtered.filter((o) => o.urgentOverride || (o.canPackage && o.daysUntilDue !== null && o.daysUntilDue <= 3)).length

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📦 {t('page.needToPackage')}</h1>
      <p className="text-muted-foreground text-sm mb-4">{t('page.needToPackageSubtitle')}</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">{t('stats.totalOrders')}</p>
          <p className="text-xl font-bold">{totalOrders}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">{t('stats.readyToPackage')}</p>
          <p className="text-xl font-bold text-green-600">{readyCount}</p>
        </div>
        <div className="bg-red-500/10 rounded-lg p-3">
          <p className="text-xs text-red-500">{t('stats.missingStock')}</p>
          <p className="text-xl font-bold text-red-500">{missingCount}</p>
        </div>
        <div className="bg-orange-500/10 rounded-lg p-3">
          <p className="text-xs text-orange-500">{t('stats.urgentReady')}</p>
          <p className="text-xl font-bold text-orange-500">{urgentReady}</p>
        </div>
      </div>

      {/* Category filter chips */}
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

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun={t('needToPackage.noun')}
          exportFilename="need-to-package"
          page="need-to-package"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => getOrderKey(row as unknown as Order)}
          expandedRowKey={expandedOrderKey}
          onRowClick={(row) => toggleExpanded(row as unknown as Order)}
          renderExpandedContent={(row) => {
            const order = row as unknown as PackageOrder
            return (
              <OrderDetail
                ifNumber={order.ifNumber}
                line={order.line}
                isShipped={false}
                partNumber={order.partNumber}
                tirePartNum={order.tire}
                hubPartNum={order.hub}
                onClose={() => setExpandedOrderKey(null)}
              />
            )
          }}
          cardClassName={(row) => {
            const order = row as unknown as PackageOrder
            if (order.urgentOverride) return 'border-l-red-500 bg-red-500/5'
            if (order.canPackage) return 'border-l-green-500'
            if (order.daysUntilDue !== null && order.daysUntilDue < 0) return 'border-l-red-500'
            if (order.daysUntilDue !== null && order.daysUntilDue <= 3) return 'border-l-orange-500'
            return 'border-l-yellow-500'
          }}
          rowClassName={(row) => {
            const order = row as unknown as PackageOrder
            if (order.urgentOverride) return 'bg-red-500/10'
            return ''
          }}
          renderCard={(row, i) => {
            const order = row as unknown as PackageOrder
            return (
              <OrderCard
                order={order}
                index={i}
                isExpanded={expandedOrderKey === getOrderKey(order)}
                onToggle={() => toggleExpanded(order)}
                statusOverride={order.canPackage ? `✓ ${t('needToPackage.ready')}` : `✗ ${t('needToPackage.missing')}`}
                extraFields={
                  <div>
                    <span className="text-muted-foreground">{t('needToPackage.stock')}</span>
                    <p className={`font-semibold ${order.availableStock >= order.orderQty ? 'text-green-600' : 'text-red-500'}`}>
                      {order.availableStock.toLocaleString()}
                    </p>
                  </div>
                }
              />
            )
          }}
        />
      )}
    </div>
  )
}
