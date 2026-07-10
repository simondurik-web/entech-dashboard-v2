'use client'

import { Suspense, useEffect, useState, useMemo, useCallback } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { DataTable } from '@/components/data-table'
import { OrderDetail } from '@/components/OrderDetail'
import { OrderCard } from '@/components/cards/OrderCard'
import { InventoryPopover } from '@/components/InventoryPopover'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order, InventoryItem } from '@/lib/google-sheets-shared'
import { normalizeStatus } from '@/lib/google-sheets-shared'
import { useI18n } from '@/lib/i18n'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { useCountUp } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'
import { getEffectivePriority, type PriorityValue } from '@/lib/priority'
import { computeComponentAvailability, type ComponentAvailabilityMap } from '@/lib/component-availability'
import { OrderSpecsGrid } from '@/components/cards/OrderSpecsGrid'
import { PriorityOverride } from '@/components/PriorityOverride'
import { getExtraOrderColumns } from '@/lib/extra-order-columns'
import { usePermissions } from '@/lib/use-permissions'
import { useAuth } from '@/lib/auth-context'
import { authHeaders } from '@/lib/session-token'
import { LabelPreviewModal } from '@/components/labels/LabelPreviewModal'
import { GenerateLabelsDialog } from '@/components/labels/GenerateLabelsDialog'
import type { LabelData } from '@/lib/label-utils'
import { Tag } from 'lucide-react'
import { AssigneeEditor } from '@/components/AssigneeEditor'
import { cacheGetJson, fetchJsonAndCache } from '@/lib/data-cache'

type FilterKey = 'all' | 'rolltech' | 'molding' | 'snappad'

interface PackageOrder extends Order {
  availableStock: number
  /** Physical on-hand total from ERPNext. */
  onHandStock: number
  /** Stock reserved to sales orders (ERPNext) — shown beside Available. */
  committedStock: number
  canPackage: boolean
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

function getColumns(t: (key: string) => string, compAvail: ComponentAvailabilityMap, onPriorityUpdate?: (line: string, p: PriorityValue) => void, onLabelClick?: (order: PackageOrder) => void, onAssigneeUpdate?: (line: string, name: string) => void, printedLines?: Set<string>): ColumnDef<PackageRow>[] {
  return [
    { key: 'category', label: t('table.category'), sortable: true, filterable: true },
    {
      key: 'requestedDate',
      label: t('table.dueDate'),
      sortable: true,
      render: (v) => String(v || '-'),
    },
    {
      key: 'effectivePriority' as keyof PackageRow & string,
      label: t('table.priority'),
      sortable: true,
      filterable: true,
      render: (_v, row) => {
        const order = row as unknown as PackageOrder
        const effective = getEffectivePriority(order)
        const isOverridden = !!order.priorityOverride
        const badge = !effective
          ? <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">-</span>
          : effective === 'URGENT'
            ? <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-600 text-white">URGENT</span>
            : <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                effective === 'P1' ? 'bg-red-500/20 text-red-600' :
                effective === 'P2' ? 'bg-orange-500/20 text-orange-600' :
                effective === 'P3' ? 'bg-yellow-500/20 text-yellow-600' :
                'bg-blue-500/20 text-blue-600'
              }`}>{effective}</span>
        return (
          <span className="inline-flex items-center">
            {badge}
            {onPriorityUpdate && (
              <PriorityOverride
                line={order.line}
                currentPriority={effective}
                isOverridden={isOverridden}
                onUpdate={onPriorityUpdate}
              />
            )}
          </span>
        )
      },
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
      key: 'onHandStock',
      label: t('table.onHand'),
      sortable: true,
      render: (v) => ((v as number) ?? 0).toLocaleString(),
    },
    {
      key: 'committedStock',
      label: t('table.committed'),
      sortable: true,
      render: (v) => {
        const n = (v as number) ?? 0
        return n > 0
          ? <span className="text-amber-400 font-semibold">{n.toLocaleString()}</span>
          : <span className="text-muted-foreground">—</span>
      },
    },
    {
      key: 'fusionInventory',
      label: t('table.fusionInv'),
      sortable: true,
      render: (v) => {
        const n = v as number
        return <span className="font-semibold">{n > 0 ? n.toLocaleString() : '0'}</span>
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
        const avail = compAvail.get(tire.toUpperCase())
        return (
          <span className="inline-flex items-center gap-1">
            <span className={avail?.ok ? 'text-green-500 font-semibold' : 'text-red-400 font-bold'}>{tire}</span>
            <InventoryPopover partNumber={tire} partType="tire" needed={avail?.demand} />
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
        const avail = compAvail.get(hub.toUpperCase())
        return (
          <span className="inline-flex items-center gap-1">
            <span className={avail?.ok ? 'text-green-500 font-semibold' : 'text-red-400 font-bold'}>{hub}</span>
            <InventoryPopover partNumber={hub} partType="hub" needed={avail?.demand} />
          </span>
        )
      },
    },
    { key: 'hubMold', label: t('table.hubMold'), sortable: true, filterable: true },
    { key: 'bearings', label: t('table.bearings'), sortable: true, filterable: true },
    {
      key: 'assignedTo',
      label: t('table.assignedTo'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const order = row as unknown as PackageOrder
        if (onAssigneeUpdate) {
          return (
            <AssigneeEditor
              line={order.line}
              currentAssignee={String(v || '')}
              onUpdated={onAssigneeUpdate}
            />
          )
        }
        return String(v || '')
      },
    },
    {
      key: 'internalStatus',
      label: t('table.status'),
      sortable: true,
      filterable: true,
      render: (v, row) => <StatusBadge status={normalizeStatus(String(v || ''), String(row.ifStatus || ''))} t={t} />,
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
    // Label button column
    ...(onLabelClick ? [{
      key: 'labelAction' as keyof PackageRow & string,
      label: '🏷️',
      render: (_v: PackageRow[keyof PackageRow], row: PackageRow) => {
        const order = row as unknown as PackageOrder
        const isPrinted = printedLines?.has(order.line)
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onLabelClick(order) }}
            className={`rounded p-1 hover:bg-muted transition-colors ${isPrinted ? 'text-green-500' : 'text-muted-foreground'}`}
            title={isPrinted ? 'Printed ✓' : 'Print label'}
          >
            <Tag className="size-4" />
            {isPrinted && <span className="sr-only">Printed</span>}
          </button>
        )
      },
    }] as ColumnDef<PackageRow>[] : []),
    // Extra columns — hidden by default
    ...getExtraOrderColumns<PackageRow>(new Set([
      'category', 'requestedDate', 'effectivePriority', 'line', 'customer', 'ifNumber',
      'partNumber', 'numPackages', 'packaging', 'partsPerPackage', 'orderQty',
      'onHandStock', 'committedStock', 'fusionInventory', 'tire', 'hub', 'hubMold', 'bearings', 'assignedTo',
      'internalStatus', 'daysUntilDue',
    ])),
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
  const { user, profile } = useAuth()
  const { canAccess } = usePermissions()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [orders, setOrders] = useState<PackageOrder[]>([])
  const [compAvail, setCompAvail] = useState<ComponentAvailabilityMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)
  const [labelPreview, setLabelPreview] = useState<LabelData | null>(null)
  const [allLabelsForOrder, setAllLabelsForOrder] = useState<LabelData[]>([])
  const [showLabelPreview, setShowLabelPreview] = useState(false)
  const [labelWarning, setLabelWarning] = useState<string | null>(null)
  const [printedLines, setPrintedLines] = useState<Set<string>>(new Set())
  // Generate Labels dialog (opened from a row's tag button) — focused on one line
  const [genDialogOpen, setGenDialogOpen] = useState(false)
  const [genDialogLine, setGenDialogLine] = useState<string | undefined>(undefined)

  const handlePriorityUpdate = useCallback((line: string, newPriority: PriorityValue) => {
    setOrders(prev => prev.map(o => {
      if (o.line !== line) return o
      return { ...o, priorityOverride: newPriority, priorityChangedAt: new Date().toISOString() }
    }))
  }, [])

  const handleAssigneeUpdate = useCallback((line: string, newAssignee: string) => {
    setOrders(prev => prev.map(o =>
      o.line === line ? { ...o, assignedTo: newAssignee } : o
    ))
  }, [])

  const handleLabelPrint = useCallback(async (label: LabelData) => {
    if (!user) return
    const printedName = profile?.full_name || user.email || 'Unknown'
    try {
      await fetch(`/api/labels/${label.id}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          label_status: 'printed',
          printed_by_name: printedName,
        }),
      })
      // Update local printed state for icon visual
      setPrintedLines(prev => new Set([...prev, label.order_line]))
    } catch (e) {
      console.error('Failed to update label status:', e)
    }
  }, [user, profile])

  // Tag button now opens the Generate Labels dialog focused on this order, so
  // the user can pick a custom qty / "use full pallets" before generating —
  // rather than silently generating with the sheet's even-split parts_per_package.
  const handleLabelClick = useCallback((order: PackageOrder) => {
    setLabelWarning(null)
    setGenDialogLine(String(order.line))
    setGenDialogOpen(true)
  }, [])

  // After the dialog generates/reprints, refresh the printed-state and open the
  // print preview for the freshly generated label set.
  const handleLabelGenerated = useCallback(async (label?: LabelData) => {
    if (!label) return
    try {
      const res = await fetch(`/api/labels?order_line=${encodeURIComponent(label.order_line)}`)
      const all = await res.json()
      setLabelPreview(label)
      setAllLabelsForOrder(Array.isArray(all) && all.length ? all : [label])
      setShowLabelPreview(true)
    } catch {
      setLabelPreview(label)
      setAllLabelsForOrder([label])
      setShowLabelPreview(true)
    }
  }, [])

  const FILTERS = useMemo(() => [
    { key: 'all' as const, label: t('category.all') },
    { key: 'rolltech' as const, label: t('category.rollTech'), emoji: '🔵' },
    { key: 'molding' as const, label: t('category.molding'), emoji: '🟡' },
    { key: 'snappad' as const, label: t('category.snappad'), emoji: '🟣' },
  ], [t])

  const showLabels = canAccess('/labels')
  const canAssign = canAccess('assign_orders')
  const columns = useMemo(() => getColumns(t, compAvail, handlePriorityUpdate, showLabels ? handleLabelClick : undefined, canAssign ? handleAssigneeUpdate : undefined, printedLines), [t, compAvail, handlePriorityUpdate, showLabels, handleLabelClick, canAssign, handleAssigneeUpdate, printedLines])

  const getOrderKey = (order: Order): string => `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`

  const toggleExpanded = (order: Order) => {
    const key = getOrderKey(order)
    setExpandedOrderKey((prev) => (prev === key ? null : key))
  }

  // Fetch printed label statuses
  useEffect(() => {
    fetch('/api/labels?status=printed')
      .then(res => res.json())
      .then((labels: LabelData[]) => {
        if (Array.isArray(labels)) {
          setPrintedLines(new Set(labels.map(l => l.order_line)))
        }
      })
      .catch(() => { /* non-critical */ })
  }, [])

  useEffect(() => {
    const applyData = ([ordersData, inventoryData]: [Order[], InventoryItem[]]) => {
        const stockMap = new Map<string, number>()
        const committedMap = new Map<string, number>()
        const onHandMap = new Map<string, number>()
        inventoryData.forEach((item) => {
          stockMap.set(item.partNumber.toUpperCase(), item.inStock)
          committedMap.set(item.partNumber.toUpperCase(), item.committed)
          onHandMap.set(item.partNumber.toUpperCase(), item.onHand)
        })

        // Tire/Hub colors: total open-order demand vs live stock + minimums
        // (computed over ALL open orders, not just this page's rows).
        setCompAvail(computeComponentAvailability(ordersData, inventoryData))

        const needToPackage = ordersData
          .filter((o) => {
            const status = normalizeStatus(o.internalStatus, o.ifStatus)
            return (status === 'pending' || status === 'wip') && !o.shippedDate
          })
          .map((o): PackageOrder => {
            // AVAILABLE stock (on hand minus committed-to-SO): inventory already
            // reserved to another order can never make this one look ready.
            const stock = stockMap.get(o.partNumber.toUpperCase()) ?? 0
            return {
              ...o,
              availableStock: stock,
              onHandStock: onHandMap.get(o.partNumber.toUpperCase()) ?? stock,
              committedStock: committedMap.get(o.partNumber.toUpperCase()) ?? 0,
              canPackage: stock >= o.orderQty,
            }
          })
          // Sort: category (RT->Molding->SnapPad), then urgent first, then priority P1->P4, then due date
          .sort((a, b) => {
            // 1. Category group
            const catDiff = categoryOrder(a.category) - categoryOrder(b.category)
            if (catDiff !== 0) return catDiff
            // 2. Urgent always on top
            const aEff = getEffectivePriority(a)
            const bEff = getEffectivePriority(b)
            if (aEff === 'URGENT' && bEff !== 'URGENT') return -1
            if (aEff !== 'URGENT' && bEff === 'URGENT') return 1
            // 3. Priority (P1 before P4)
            const priOrder: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 }
            const aPri = (aEff && priOrder[aEff]) || 99
            const bPri = (bEff && priOrder[bEff]) || 99
            if (aPri !== bPri) return aPri - bPri
            // 4. Due date (earlier = higher)
            return (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999)
          })

        setOrders(needToPackage.map(o => ({ ...o, effectivePriority: getEffectivePriority(o as unknown as Order) || '-' })) as typeof needToPackage)
    }

    // Paint instantly from the device cache when both payloads are present;
    // the network fetch below revalidates and overwrites within ~1s.
    Promise.all([
      cacheGetJson<Order[]>('/api/sheets'),
      cacheGetJson<InventoryItem[]>('/api/inventory'),
    ]).then(([cachedOrders, cachedInventory]) => {
      if (cachedOrders && cachedInventory) {
        applyData([cachedOrders, cachedInventory])
        setLoading(false)
      }
    })

    Promise.all([
      fetchJsonAndCache<Order[]>('/api/sheets'),
      fetchJsonAndCache<InventoryItem[]>('/api/inventory'),
    ])
      .then(applyData)
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

  const animTotalOrders = useCountUp(totalOrders)
  const animReadyCount = useCountUp(readyCount)
  const animMissingCount = useCountUp(missingCount)
  const animUrgentReady = useCountUp(urgentReady)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📦 {t('page.needToPackage')}</h1>
      <p className="text-muted-foreground text-sm mb-4">{t('page.needToPackageSubtitle')}</p>

      {/* Stats row */}
      <ScrollReveal>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SpotlightCard className="bg-muted rounded-lg p-3 stat-card-hover" spotlightColor="148,163,184">
          <p className="text-xs text-muted-foreground">{t('stats.totalOrders')}</p>
          <p className="text-xl font-bold">{animTotalOrders}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-green-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-green" spotlightColor="34,197,94">
          <p className="text-xs text-green-600">{t('stats.readyToPackage')}</p>
          <p className="text-xl font-bold text-green-600">{animReadyCount}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-red-500/10 rounded-lg p-3 stat-card-hover" spotlightColor="239,68,68">
          <p className="text-xs text-red-500">{t('stats.missingStock')}</p>
          <p className="text-xl font-bold text-red-500">{animMissingCount}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-orange-500/10 rounded-lg p-3 stat-card-hover stat-card-hover-amber" spotlightColor="249,115,22">
          <p className="text-xs text-orange-500">{t('stats.urgentReady')}</p>
          <p className="text-xl font-bold text-orange-500">{animUrgentReady}</p>
        </SpotlightCard>
      </div>
      </ScrollReveal>

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
        <TableSkeleton rows={8} />
      )}

      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {labelWarning && (
        <div className="mb-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
          ⚠️ {labelWarning}
          <button onClick={() => setLabelWarning(null)} className="ml-2 text-xs underline">dismiss</button>
        </div>
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
          /* OrderCard already shows PO# and the status badge — keep the phone
             extra-fields strip from duplicating them when toggled on. */
          mobileCardShownKeys={['poNumber', 'ifStatus']}
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
                customer={order.customer}
                poNumber={order.poNumber}
                canEdit={canAccess('edit_pallet_records')}
                userName={profile?.full_name || ''}
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
            const isRollTech = order.category.toLowerCase().includes('roll')
            return (
              <OrderCard
                order={order}
                index={i}
                isExpanded={expandedOrderKey === getOrderKey(order)}
                onToggle={() => toggleExpanded(order)}
                canEdit={canAccess('edit_pallet_records')}
                userName={profile?.full_name || ''}
                statusOverride={order.canPackage ? `✓ ${t('needToPackage.ready')}` : `✗ ${t('needToPackage.missing')}`}
                // same availability color the desktop Part # cell uses
                partClassName={isRollTech ? '' : (order.fusionInventory >= order.orderQty ? 'text-green-500 font-semibold' : 'text-red-400 font-bold')}
                expandedFields={
                  <OrderSpecsGrid
                    order={order}
                    compAvail={compAvail}
                    stock={{ onHand: order.onHandStock, committed: order.committedStock, available: order.availableStock }}
                  />
                }
                extraFields={
                  <>
                    <div>
                      <span className="text-muted-foreground">{t('needToPackage.stock')}</span>
                      <p className={`font-semibold ${order.availableStock >= order.orderQty ? 'text-green-600' : 'text-red-500'}`}>
                        {order.availableStock.toLocaleString()}
                      </p>
                    </div>
                    {order.committedStock > 0 && (
                      <div>
                        <span className="text-muted-foreground">{t('table.committed')}</span>
                        <p className="font-semibold text-amber-500">{order.committedStock.toLocaleString()}</p>
                      </div>
                    )}
                    {isRollTech && order.tire && order.tire !== '-' && (
                      <div>
                        <span className="text-muted-foreground">{t('table.tire')}</span>
                        <p className={`font-semibold ${compAvail.get(order.tire.toUpperCase())?.ok ? 'text-green-500' : 'text-red-400'}`}>{order.tire}</p>
                      </div>
                    )}
                    {isRollTech && order.hub && order.hub !== '-' && (
                      <div className="col-span-2 min-w-0">
                        <span className="text-muted-foreground">{t('table.hub')}</span>
                        <p className={`font-semibold truncate ${compAvail.get(order.hub.toUpperCase())?.ok ? 'text-green-500' : 'text-red-400'}`}>{order.hub}</p>
                      </div>
                    )}
                  </>
                }
              />
            )
          }}
        />
      )}

      <LabelPreviewModal
        label={labelPreview}
        siblingLabels={allLabelsForOrder}
        open={showLabelPreview}
        onOpenChange={setShowLabelPreview}
        onPrint={handleLabelPrint}
      />

      <GenerateLabelsDialog
        open={genDialogOpen}
        onOpenChange={setGenDialogOpen}
        initialLine={genDialogLine}
        onGenerated={handleLabelGenerated}
      />
    </div>
  )
}
