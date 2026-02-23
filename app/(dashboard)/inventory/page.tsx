'use client'

import { Suspense, useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, X, ExternalLink } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { InventoryItem, InventoryHistoryData } from '@/lib/google-sheets'
import Link from 'next/link'
import { usePermissions } from '@/lib/use-permissions'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { useCountUp, useCountUpDecimal } from '@/lib/use-count-up'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'
import { TableSkeleton } from "@/components/ui/skeleton-loader"

// ─── Types ───

interface InventoryRow extends Record<string, unknown> {
  product: string
  partNumber: string
  fusionQty: number
  minimum: number
  manualTarget: number
  qtyNeeded: number
  partsToBeMade: number
  moldType: string
  avgUsage: number | null
  trend: string
  trendColor: string
  daysToMin: number | null
  daysToZero: number | null
  status: string
  itemType: string
  isManufactured: boolean
  department: string
  subDepartment: string
  unitCost: number | null
  totalValue: number | null
  monthValueChange: number | null
  // raw fields for filtering
  _raw: InventoryItem
}

interface HistoryData {
  dates: string[]
  dataByDate: Record<string, number>
}

interface CostEntry {
  fusionId: string
  description: string
  netsuiteId: string
  cost: number | null
  lowerCost: number | null
  department: string
  subDepartment: string
}

function parseUsDate(date: string): Date | null {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
}

type DeptFilterKey = 'molding' | 'rubber' | 'melt'

const DEPT_FILTERS: { key: DeptFilterKey; label: string; emoji: string }[] = [
  { key: 'molding', label: 'Molding', emoji: '🏭' },
  { key: 'rubber', label: 'Rubber', emoji: '♻️' },
  { key: 'melt', label: 'Melt Line', emoji: '🔥' },
]

type StockFilterKey = 'all' | 'low' | 'production' | 'running-low'
type TypeFilterKey = 'manufactured' | 'purchased' | 'com'

// ─── Usage Calculation (ported from HTML dashboard) ───

function calculateUsageStats(
  currentQty: number,
  minimum: number,
  historyDates: string[],
  dataByDate: Record<string, number>
) {
  if (!historyDates.length) return { usage7: null, usage30: null, projectionRate: null, daysToZero: null, daysToMin: null, trend: '→', trendLabel: 'Stable', trendColor: 'text-gray-400' }

  const now = Date.now()
  const sorted = historyDates
    .map(d => ({ date: d, time: new Date(d).getTime(), qty: dataByDate[d] ?? 0 }))
    .filter(d => !isNaN(d.time))
    .sort((a, b) => a.time - b.time)

  if (sorted.length < 2) return { usage7: null, usage30: null, projectionRate: null, daysToZero: null, daysToMin: null, trend: '→', trendLabel: 'Stable', trendColor: 'text-gray-400' }

  const calcUsage = (daysAgo: number) => {
    const target = now - daysAgo * 86400000
    let closest = sorted[0]
    let minDiff = Math.abs(sorted[0].time - target)
    for (const pt of sorted) {
      const diff = Math.abs(pt.time - target)
      if (diff < minDiff) { closest = pt; minDiff = diff }
    }
    const actualDays = (now - closest.time) / 86400000
    if (actualDays < 1) return null
    const usage = (closest.qty - currentQty) / actualDays
    return usage > 0 ? usage : null
  }

  const usage7 = calcUsage(7)
  const usage30 = calcUsage(30)
  const projectionRate = usage30 ?? usage7

  const daysToZero = projectionRate && projectionRate > 0 ? Math.round(currentQty / projectionRate) : null
  const daysToMin = projectionRate && projectionRate > 0
    ? (currentQty > minimum ? Math.round((currentQty - minimum) / projectionRate) : 0)
    : null

  let trend = '→', trendLabel = 'Stable', trendColor = 'text-gray-400'
  if (usage7 != null && usage30 != null && usage30 > 0) {
    if (usage7 > usage30 * 1.1) { trend = '↑'; trendLabel = 'Up'; trendColor = 'text-red-400' }
    else if (usage7 < usage30 * 0.9) { trend = '↓'; trendLabel = 'Down'; trendColor = 'text-green-400' }
  }

  return { usage7, usage30, projectionRate, daysToZero, daysToMin, trend, trendLabel, trendColor }
}

function calculateProductionStats(
  currentQty: number,
  target: number,
  historyDates: string[],
  dataByDate: Record<string, number>
) {
  if (!historyDates.length) return { prod7: null, prod30: null, daysToTarget: null, trend: '→', trendLabel: 'Stable', trendColor: 'text-gray-400' }

  const now = Date.now()
  const sorted = historyDates
    .map(d => ({ date: d, time: new Date(d).getTime(), qty: dataByDate[d] ?? 0 }))
    .filter(d => !isNaN(d.time))
    .sort((a, b) => a.time - b.time)

  const calcProduction = (daysAgo: number) => {
    const cutoff = now - daysAgo * 86400000
    const points = sorted.filter(p => p.time >= cutoff)
    if (points.length < 2) return null
    let totalProduced = 0
    for (let i = 1; i < points.length; i++) {
      const diff = points[i].qty - points[i - 1].qty
      if (diff > 0) totalProduced += diff
    }
    const actualDays = (now - points[0].time) / 86400000
    return actualDays > 0 ? totalProduced / actualDays : null
  }

  const prod7 = calcProduction(7)
  const prod30 = calcProduction(30)
  const rate = prod30 ?? prod7

  const daysToTarget = rate && rate > 0 && target > currentQty
    ? Math.round((target - currentQty) / rate)
    : null

  let trend = '→', trendLabel = 'Stable', trendColor = 'text-gray-400'
  if (prod7 != null && prod30 != null && prod30 > 0) {
    if (prod7 > prod30 * 1.1) { trend = '↑'; trendLabel = 'Faster'; trendColor = 'text-green-400' }
    else if (prod7 < prod30 * 0.9) { trend = '↓'; trendLabel = 'Slower'; trendColor = 'text-red-400' }
  }

  return { prod7, prod30, daysToTarget, trend, trendLabel, trendColor }
}

// ─── Constants ───

const STOCK_FILTERS: { key: StockFilterKey; labelKey: string; emoji?: string }[] = [
  { key: 'all', labelKey: 'inventory.all' },
  { key: 'low', labelKey: 'inventory.lowStock', emoji: '⚠️' },
  { key: 'production', labelKey: 'inventory.needsProduction', emoji: '🔧' },
  { key: 'running-low', labelKey: 'inventory.runningLow', emoji: '🔥' },
]

const TYPE_FILTERS: { key: TypeFilterKey; labelKey: string; emoji: string }[] = [
  { key: 'manufactured', labelKey: 'inventory.manufactured', emoji: '🏭' },
  { key: 'purchased', labelKey: 'inventory.purchased', emoji: '🛒' },
  { key: 'com', labelKey: 'inventory.com', emoji: '📦' },
]

// ─── Column Definitions ───

function makeColumns(onHistoryClick: (partNumber: string) => void, t: (key: string) => string, showCosts: boolean): ColumnDef<InventoryRow>[] {
  const cols: ColumnDef<InventoryRow>[] = [
    { key: 'department', label: 'Dept', sortable: true, filterable: true, render: (v) => <span className="text-[11px] text-muted-foreground">{String(v)}</span> },
    { key: 'subDepartment', label: 'Sub Dept', sortable: true, filterable: true, render: (v) => <span className="text-[11px] text-muted-foreground">{String(v)}</span> },
    { key: 'product', label: t('inventory.colProduct'), sortable: true, filterable: true, render: (v) => <span className="text-[11px]">{String(v)}</span> },
    {
      key: 'partNumber', label: t('inventory.colPartNumber'), sortable: true, filterable: true,
      render: (v) => (
        <span className="font-bold text-xs">{String(v)}</span>
      ),
    },
    { key: 'fusionQty', label: t('inventory.colFusionQty'), sortable: true, render: (v) => <span className="text-xs">{Number(v).toLocaleString()}</span> },
    ...(showCosts ? [
      {
        key: 'unitCost' as const,
        label: '💰 Unit Cost',
        sortable: true,
        render: (v: unknown) => {
          if (v == null) return <span className="text-muted-foreground">-</span>
          return <span className="text-emerald-400 font-medium">${Number(v).toFixed(2)}</span>
        },
      },
      {
        key: 'totalValue' as const,
        label: '💰 Total Value',
        sortable: true,
        render: (v: unknown) => {
          if (v == null) return <span className="text-muted-foreground">-</span>
          return <span className="text-emerald-400 font-semibold">${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        },
      },
      {
        key: 'monthValueChange' as const,
        label: '📅 Month Δ',
        sortable: true,
        render: (v: unknown) => {
          if (v == null) return <span className="text-muted-foreground">-</span>
          const n = Number(v)
          if (Math.abs(n) < 0.01) return <span className="text-muted-foreground">—</span>
          const color = n >= 0 ? 'text-green-400' : 'text-red-400'
          const arrow = n >= 0 ? '↑' : '↓'
          return <span className={`${color} font-medium`}>{arrow} ${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        },
      },
    ] as ColumnDef<InventoryRow>[] : []),
    { key: 'minimum', label: t('inventory.colMinimum'), sortable: true, render: (v) => Number(v).toLocaleString() },
    { key: 'manualTarget', label: t('inventory.colManualTarget'), sortable: true, render: (v) => Number(v).toLocaleString() },
    { key: 'qtyNeeded', label: t('inventory.colQtyNeeded'), sortable: true, render: (v) => Number(v).toLocaleString() },
    {
      key: 'partsToBeMade', label: t('inventory.colPartsToMake'), sortable: true,
      render: (v) => {
        const n = Number(v)
        return <span className={n > 0 ? 'text-red-400 font-semibold' : ''}>{n.toLocaleString()}</span>
      },
    },
    { key: 'moldType', label: t('inventory.colMoldType'), sortable: true, filterable: true },
    {
      key: 'avgUsage', label: t('inventory.colAvgUsage'), sortable: true,
      render: (v, row) => {
        if (v == null) return '-'
        const n = Number(v)
        const isMfg = row.isManufactured
        return (
          <span className={isMfg ? 'text-blue-400' : 'text-sky-300'}>
            {n.toFixed(1)} {isMfg ? '⚙️' : ''}
          </span>
        )
      },
    },
    {
      key: 'trend', label: t('inventory.colTrend'), sortable: true,
      render: (v, row) => <span className={String(row.trendColor)}>{String(v)}</span>,
    },
    {
      key: 'daysToMin', label: t('inventory.colDaysToMin'), sortable: true,
      render: (v) => {
        if (v == null) return '-'
        const n = Number(v)
        const color = n < 14 ? 'text-red-400' : n < 30 ? 'text-yellow-400' : 'text-green-400'
        return <span className={color}>{n}d</span>
      },
    },
    {
      key: 'daysToZero', label: t('inventory.colDaysToZero'), sortable: true,
      render: (v, row) => {
        if (row.isManufactured) return <span className="text-muted-foreground">-</span>
        if (v == null) return '-'
        const n = Number(v)
        const color = n < 14 ? 'text-red-400' : n < 30 ? 'text-yellow-400' : 'text-green-400'
        return <span className={color}>{n}d</span>
      },
    },
    {
      key: 'status', label: t('inventory.colStatus'), sortable: true, filterable: true,
      render: (v) => {
        const s = String(v)
        if (s === 'MAKE') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400">{t('inventory.statusMake')}</span>
        if (s === 'LOW') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400">{t('inventory.statusLow')}</span>
        return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">{t('inventory.statusOk')}</span>
      },
    },
    {
      key: 'itemType', label: t('inventory.colItemType'), sortable: true, filterable: true,
      render: (v) => {
        const val = String(v)
        if (val === 'Manufactured') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400">🏭 {t('inventory.manufactured')}</span>
        if (val === 'Purchased') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">🛒 {t('inventory.purchased')}</span>
        if (val === 'COM') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-500/20 text-orange-400">📦 {t('inventory.com')}</span>
        return <span className="text-muted-foreground">{val || '-'}</span>
      },
    },
  ]

  return cols
}

// ─── History Modal ───

function HistoryModal({
  partNumber,
  itemType,
  currentQty,
  minimum,
  target,
  onClose,
}: {
  partNumber: string
  itemType: string
  currentQty: number
  minimum: number
  target: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<unknown>(null)
  const [historyData, setHistoryData] = useState<HistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const isMfg = itemType === 'Manufactured'

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/inventory-history')
        if (!res.ok) throw new Error('Failed')
        const data: InventoryHistoryData = await res.json()
        const part = data.parts.find(p => p.partNumber.toUpperCase() === partNumber.toUpperCase())
        if (!cancelled) {
          setHistoryData(part ? { dates: data.dates, dataByDate: part.dataByDate } : null)
        }
      } catch {
        if (!cancelled) setHistoryData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [partNumber])

  // Chart rendering
  useEffect(() => {
    if (!historyData || !canvasRef.current) return

    let dates = historyData.dates
    const dataByDate = historyData.dataByDate

    // Apply date range filter
    if (startDate) dates = dates.filter(d => new Date(d) >= new Date(startDate))
    if (endDate) dates = dates.filter(d => new Date(d) <= new Date(endDate))

    const values = dates.map(d => dataByDate[d] ?? 0)

    // Dynamic import chart.js
    Promise.all([
      import('chart.js'),
      import('react-chartjs-2'),
    ]).then(([chartjs]) => {
      const { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend } = chartjs
      Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend)

      // Destroy previous chart
      if (chartRef.current) {
        (chartRef.current as { destroy: () => void }).destroy()
      }

      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return

      const gradient = ctx.createLinearGradient(0, 0, 0, 300)
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)')
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0)')

      chartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: dates,
          datasets: [
            {
              label: 'Inventory',
              data: values,
              borderColor: '#3b82f6',
              backgroundColor: gradient,
              fill: true,
              tension: 0.3,
              pointRadius: 2,
              pointHoverRadius: 5,
            },
            ...(minimum > 0 ? [{
              label: 'Minimum',
              data: Array(dates.length).fill(minimum),
              borderColor: '#ef4444',
              borderDash: [5, 5],
              pointRadius: 0,
              fill: false,
            }] : []),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#9ca3af' } },
            tooltip: { mode: 'index', intersect: false },
          },
          scales: {
            x: { ticks: { color: '#6b7280', maxTicksLimit: 10 }, grid: { color: 'rgba(75,85,99,0.3)' } },
            y: { ticks: { color: '#6b7280' }, grid: { color: 'rgba(75,85,99,0.3)' } },
          },
        },
      })
    })

    return () => {
      if (chartRef.current) {
        (chartRef.current as { destroy: () => void }).destroy()
        chartRef.current = null
      }
    }
  }, [historyData, startDate, endDate, minimum])

  // Stats calculations
  const stats = useMemo(() => {
    if (!historyData) return null
    const values = historyData.dates.map(d => historyData.dataByDate[d] ?? 0).filter(v => v > 0)
    const max = values.length ? Math.max(...values) : 0
    const avg = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0

    if (isMfg) {
      const { prod7, prod30, daysToTarget, trend, trendLabel, trendColor } = calculateProductionStats(currentQty, target || minimum, historyData.dates, historyData.dataByDate)
      return { max, avg, prod7, prod30, daysToTarget, trend, trendLabel, trendColor, isMfg: true }
    } else {
      const { usage7, usage30, daysToZero, daysToMin, trend, trendLabel, trendColor } = calculateUsageStats(currentQty, minimum, historyData.dates, historyData.dataByDate)
      return { max, avg, usage7, usage30, daysToZero, daysToMin, trend, trendLabel, trendColor, isMfg: false }
    }
  }, [historyData, currentQty, minimum, target, isMfg])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-[95vw] max-w-4xl max-h-[90vh] overflow-auto p-6 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">📈 {t('inventory.historyTitle')} — {partNumber}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700 transition-colors"><X className="size-5" /></button>
        </div>

        {loading ? (
          <TableSkeleton rows={8} />
        ) : !historyData ? (
          <p className="text-center text-muted-foreground py-10">{t('inventory.noHistoryData')} {partNumber}</p>
        ) : (
          <>
            {/* Date Range Controls */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <div>
                <label className="text-xs text-muted-foreground">{t('inventory.startDate')}</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="block mt-1 px-3 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t('inventory.endDate')}</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className="block mt-1 px-3 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm" />
              </div>
            </div>

            {/* Chart */}
            <div className="h-[300px] mb-6">
              <canvas ref={canvasRef} />
            </div>

            {/* Stats Panels */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{t('inventory.currentQty')}</p>
                <p className="text-lg font-bold">{currentQty.toLocaleString()}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{t('inventory.minimumThreshold')}</p>
                <p className="text-lg font-bold">{minimum.toLocaleString()}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{t('inventory.historicalMax')}</p>
                <p className="text-lg font-bold">{stats?.max.toLocaleString() ?? '-'}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">{t('inventory.average')}</p>
                <p className="text-lg font-bold">{stats?.avg.toLocaleString() ?? '-'}</p>
              </div>
            </div>

            {/* Usage/Production Stats */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? t('inventory.prodAvg7') : t('inventory.usageAvg7')}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg
                      ? ((stats as { prod7: number | null }).prod7?.toFixed(1) ?? '-')
                      : ((stats as { usage7: number | null }).usage7?.toFixed(1) ?? '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? t('inventory.prodAvg30') : t('inventory.usageAvg30')}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg
                      ? ((stats as { prod30: number | null }).prod30?.toFixed(1) ?? '-')
                      : ((stats as { usage30: number | null }).usage30?.toFixed(1) ?? '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? t('inventory.daysToTarget') : t('inventory.daysToMinimum')}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg
                      ? ((stats as { daysToTarget: number | null }).daysToTarget != null ? `${(stats as { daysToTarget: number }).daysToTarget}d` : '-')
                      : ((stats as { daysToMin: number | null }).daysToMin != null ? `${(stats as { daysToMin: number }).daysToMin}d` : '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? 'N/A' : t('inventory.daysToZero')}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg ? '-' : ((stats as { daysToZero: number | null }).daysToZero != null ? `${(stats as { daysToZero: number }).daysToZero}d` : '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? t('inventory.productionTrend') : t('inventory.usageTrend')}</p>
                  <p className={`text-lg font-bold ${stats.trendColor}`}>{stats.trend} {stats.trendLabel}</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ───

export default function InventoryPage() {
  return <Suspense><InventoryPageContent /></Suspense>
}

function InventoryPageContent() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [historyData, setHistoryData] = useState<InventoryHistoryData | null>(null)
  const [costData, setCostData] = useState<Record<string, CostEntry>>({})
  const { canAccess } = usePermissions()
  const showCosts = canAccess('view_inventory_values')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deptFilters, setDeptFilters] = useState<Set<DeptFilterKey>>(new Set())
  const [stockFilter, setStockFilter] = useState<StockFilterKey>('all')
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilterKey>>(new Set())
  const [search, setSearch] = useState('')
  const [historyPart, setHistoryPart] = useState<string | null>(null)
  const [moversExpand, setMoversExpand] = useState<0 | 1 | 2>(0) // 0=top10, 1=top30 with chart, 2=collapsed
  const { t } = useI18n()

  const toggleDeptFilter = (key: DeptFilterKey) => {
    setDeptFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const toggleTypeFilter = (key: TypeFilterKey) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const clearFilters = () => {
    setDeptFilters(new Set())
    setStockFilter('all')
    setTypeFilters(new Set())
    setSearch('')
  }

  const fetchData = useCallback(async (isRefresh = false, fetchCosts = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const [invRes, histRes, costRes] = await Promise.all([
        fetch('/api/inventory'),
        fetch('/api/inventory-history'),
        fetchCosts ? fetch('/api/inventory-costs') : Promise.resolve(null),
      ])
      if (!invRes.ok) throw new Error('Failed to fetch inventory')
      const invData: InventoryItem[] = await invRes.json()
      setItems(invData)
      if (histRes.ok) {
        const hd: InventoryHistoryData = await histRes.json()
        setHistoryData(hd)
      }
      if (costRes?.ok) {
        const cd = await costRes.json()
        setCostData(cd.costs ?? {})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData(false, showCosts) }, [fetchData, showCosts])

  // Find closest history date to start of current month
  const monthStartDate = useMemo(() => {
    if (!historyData?.dates.length) return null
    const now = new Date()
    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    let closest: string | null = null
    let minDiff = Infinity
    for (const d of historyData.dates) {
      const ms = parseUsDate(d)?.getTime()
      if (ms == null) continue
      const diff = Math.abs(ms - monthStartMs)
      if (diff < minDiff) { minDiff = diff; closest = d }
    }
    return minDiff <= 7 * 86400000 ? closest : null
  }, [historyData])

  // Build rows with calculated usage stats
  const rows: InventoryRow[] = useMemo(() => {
    return items.map(item => {
      const partHistory = historyData?.parts.find(p => p.partNumber.toUpperCase() === item.partNumber.toUpperCase())
      const dates = historyData?.dates ?? []
      const dataByDate = partHistory?.dataByDate ?? {}

      const fusionQty = item.inStock
      const qtyNeeded = Math.max(0, item.minimum - fusionQty)
      const partsToBeMade = item.isManufactured ? qtyNeeded : 0

      let avgUsage: number | null = null
      let trend = '→', trendColor = 'text-gray-400'
      let daysToMin: number | null = item.daysToMin
      let daysToZero: number | null = item.daysToZero

      if (item.isManufactured) {
        const stats = calculateProductionStats(fusionQty, item.target || item.minimum, dates, dataByDate)
        avgUsage = stats.prod30 ?? stats.prod7
        trend = `${stats.trend}${stats.trendLabel}`
        trendColor = stats.trendColor
        if (stats.daysToTarget != null) daysToMin = stats.daysToTarget
      } else {
        const stats = calculateUsageStats(fusionQty, item.minimum, dates, dataByDate)
        avgUsage = stats.usage30 ?? stats.usage7
        trend = `${stats.trend}${stats.trendLabel}`
        trendColor = stats.trendColor
        if (stats.daysToMin != null) daysToMin = stats.daysToMin
        if (stats.daysToZero != null) daysToZero = stats.daysToZero
      }

      // Status
      let status = 'OK'
      if (partsToBeMade > 0 || (item.minimum > 0 && fusionQty < item.minimum)) {
        status = item.isManufactured && partsToBeMade > 0 ? 'MAKE' : 'LOW'
      }
      if (item.minimum > 0 && fusionQty < item.minimum) status = fusionQty < item.minimum * 0.5 ? 'MAKE' : 'LOW'

      return {
        product: item.product,
        partNumber: item.partNumber,
        fusionQty,
        minimum: item.minimum,
        manualTarget: item.target,
        qtyNeeded,
        partsToBeMade,
        moldType: item.moldType,
        avgUsage,
        trend,
        trendColor,
        daysToMin,
        daysToZero,
        status,
        itemType: item.itemType,
        isManufactured: item.isManufactured,
        department: (() => {
          const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
          return costEntry?.department || ''
        })(),
        subDepartment: (() => {
          const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
          return costEntry?.subDepartment || ''
        })(),
        unitCost: (() => {
          // Try matching by partNumber (which is the Fusion ID)
          const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
          return costEntry?.lowerCost ?? costEntry?.cost ?? null
        })(),
        totalValue: (() => {
          const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
          const uc = costEntry?.lowerCost ?? costEntry?.cost ?? null
          return uc != null ? fusionQty * uc : null
        })(),
        monthValueChange: (() => {
          if (!monthStartDate) return null
          const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
          const uc = costEntry?.lowerCost ?? costEntry?.cost ?? null
          if (uc == null) return null
          const partHist = historyData?.parts.find(p => p.partNumber.toUpperCase() === item.partNumber.toUpperCase())
          const startQty = partHist?.dataByDate[monthStartDate] ?? fusionQty
          return (fusionQty - startQty) * uc
        })(),
        _raw: item,
      }
    })
  }, [items, historyData, costData, monthStartDate])

  // Apply filters
  const filtered = useMemo(() => {
    let result = rows

    // Department filter (multi-select — empty = all)
    if (deptFilters.size > 0) {
      result = result.filter(r => {
        const dept = r.department.toLowerCase()
        if (deptFilters.has('molding') && (dept.includes('molding') || dept.includes('compression'))) return true
        if (deptFilters.has('rubber') && dept.includes('rubber')) return true
        if (deptFilters.has('melt') && dept.includes('melt')) return true
        return false
      })
    }

    // Stock filter
    switch (stockFilter) {
      case 'low':
        result = result.filter(r => r.fusionQty < r.minimum && r.minimum > 0)
        break
      case 'production':
        result = result.filter(r => r.partsToBeMade > 0)
        break
      case 'running-low':
        result = result.filter(r => r.daysToMin != null && r.daysToMin < 30)
        break
    }

    // Type filters
    if (typeFilters.size > 0) {
      result = result.filter(r => {
        if (typeFilters.has('manufactured') && r.itemType === 'Manufactured') return true
        if (typeFilters.has('purchased') && r.itemType === 'Purchased') return true
        if (typeFilters.has('com') && r.itemType === 'COM') return true
        return false
      })
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r =>
        r.partNumber.toLowerCase().includes(q) ||
        r.product.toLowerCase().includes(q)
      )
    }

    return result
  }, [rows, deptFilters, stockFilter, typeFilters, search])

  // Stats
  const deptLabel = deptFilters.size === 0 ? '' : ` — ${[...deptFilters].map(k => DEPT_FILTERS.find(f => f.key === k)?.label).filter(Boolean).join(', ')}`

  const totalItems = filtered.length
  const productTypes = new Set(filtered.map(r => r.product)).size
  const lowStock = filtered.filter(r => r.fusionQty < r.minimum && r.minimum > 0).length
  const needsProduction = filtered.filter(r => r.partsToBeMade > 0).length
  const adequateStock = filtered.filter(r => r.fusionQty >= r.minimum || r.minimum === 0).length
  const totalInventoryValue = useMemo(() => {
    if (!showCosts) return 0
    return filtered.reduce((sum, r) => sum + (r.totalValue ?? 0), 0)
  }, [filtered, showCosts])

  // Month-start inventory value comparison
  const monthStartValue = useMemo(() => {
    if (!showCosts || !historyData) return null
    const now = new Date()
    const monthStart = `${now.getMonth() + 1}/1/${now.getFullYear()}`
    // Find closest date to month start
    const sortedDates = [...(historyData.dates || [])].sort((a, b) => {
      const da = parseUsDate(a)?.getTime() ?? 0
      const db = parseUsDate(b)?.getTime() ?? 0
      return da - db
    })
    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    let closestDate: string | null = null
    let minDiff = Infinity
    for (const d of sortedDates) {
      const ms = parseUsDate(d)?.getTime()
      if (ms == null) continue
      const diff = Math.abs(ms - monthStartMs)
      if (diff < minDiff) { minDiff = diff; closestDate = d }
    }
    if (!closestDate || minDiff > 7 * 86400000) return null // only if within 7 days

    // Calculate month-start total value for filtered items
    let startTotal = 0
    for (const row of filtered) {
      const costEntry = costData[row.partNumber] || costData[row.partNumber.replace(/^0+/, '')]
      const uc = costEntry?.lowerCost ?? costEntry?.cost ?? null
      if (uc == null) continue
      const partHist = historyData.parts.find(p => p.partNumber.toUpperCase() === row.partNumber.toUpperCase())
      const startQty = partHist?.dataByDate[closestDate!] ?? row.fusionQty
      startTotal += startQty * uc
    }
    return startTotal
  }, [filtered, historyData, costData, showCosts])

  const monthChange = monthStartValue != null ? totalInventoryValue - monthStartValue : null
  const monthChangePct = monthStartValue != null && monthStartValue > 0 ? ((monthChange ?? 0) / monthStartValue) * 100 : null

  // All items with month changes, sorted by absolute magnitude
  const allMonthChanges = useMemo(() => {
    if (!showCosts) return []
    return [...filtered]
      .filter(r => r.monthValueChange != null && Math.abs(r.monthValueChange!) > 0.01)
      .sort((a, b) => Math.abs(b.monthValueChange!) - Math.abs(a.monthValueChange!))
  }, [filtered, showCosts])

  const animTotalItems = useCountUp(totalItems)
  const animLowStock = useCountUp(lowStock)
  const animNeedsProduction = useCountUp(needsProduction)
  const animAdequateStock = useCountUp(adequateStock)
  const animInventoryValue = useCountUpDecimal(totalInventoryValue)

  const columns = useMemo(() => makeColumns(setHistoryPart, t, showCosts), [t, showCosts])

  const table = useDataTable({
    data: filtered,
    columns,
    storageKey: 'inventory',
  })

  // Find selected part for modal
  const selectedRow = historyPart ? rows.find(r => r.partNumber === historyPart) : null

  return (
    <div className="p-4 pb-20">
      {/* Bar animation keyframes + compact table */}
      <style>{`
        ${Array.from({ length: 30 }, (_, i) => `
          @keyframes bar-grow-${i} {
            from { width: 0%; opacity: 0; }
            to { opacity: 1; }
          }
        `).join('')}
        .inventory-compact-table td,
        .inventory-compact-table th {
          padding: 4px 6px !important;
          font-size: 12px;
        }
      `}</style>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📦 {t('page.inventory')}</h1>
        <button
          onClick={() => fetchData(true, showCosts)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">{t('page.inventorySubtitle')}</p>

      {/* Stats Row */}
      <ScrollReveal>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SpotlightCard className="bg-muted rounded-lg p-3 border border-zinc-700/50" spotlightColor="59,130,246" style={{ borderImage: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(139,92,246,0.3)) 1' }}>
          <p className="text-xs text-muted-foreground">{t('inventory.totalItems')}{deptLabel}</p>
          <p className="text-xl font-bold">{animTotalItems}</p>
          <p className="text-[10px] text-muted-foreground">{productTypes} {t('inventory.productTypes')}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-red-500/10 rounded-lg p-3 border border-red-500/20" spotlightColor="239,68,68">
          <p className="text-xs text-red-400">{t('stats.lowStock')}{deptLabel}</p>
          <p className="text-xl font-bold text-red-400">{animLowStock}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-yellow-500/10 rounded-lg p-3 border border-yellow-500/20" spotlightColor="234,179,8">
          <p className="text-xs text-yellow-400">{t('stats.needsProduction')}{deptLabel}</p>
          <p className="text-xl font-bold text-yellow-400">{animNeedsProduction}</p>
        </SpotlightCard>
        <SpotlightCard className="bg-green-500/10 rounded-lg p-3 border border-green-500/20" spotlightColor="34,197,94">
          <p className="text-xs text-green-400">{t('inventory.adequateStock')}{deptLabel}</p>
          <p className="text-xl font-bold text-green-400">{animAdequateStock}</p>
        </SpotlightCard>
        {showCosts && (
          <SpotlightCard className="bg-emerald-500/10 rounded-lg p-3 border border-emerald-500/20 col-span-2 sm:col-span-4" spotlightColor="16,185,129">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs text-emerald-400">💰 Total Inventory Value{deptLabel}</p>
                <p className="text-2xl font-bold text-emerald-400">
                  ${animInventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-[10px] text-muted-foreground">Based on Lower of Cost or Market</p>
              </div>
              {monthStartValue != null && monthChange != null && (
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Month Start</p>
                  <p className="text-sm font-semibold text-muted-foreground">
                    ${monthStartValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className={`text-sm font-bold ${monthChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {monthChange >= 0 ? '↑' : '↓'} ${Math.abs(monthChange).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {monthChangePct != null && (
                      <span className="text-xs ml-1">({monthChangePct >= 0 ? '+' : ''}{monthChangePct.toFixed(1)}%)</span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Change this month</p>
                </div>
              )}
            </div>
            {/* Top movers — expandable */}
            {allMonthChanges.length > 0 && (
              <div className="mt-3 pt-3 border-t border-emerald-500/20">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">
                    Top {moversExpand === 1 ? 30 : 10} Changes This Month
                  </p>
                  <button
                    onClick={() => setMoversExpand(prev => prev === 0 ? 1 : 0)}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                  >
                    {moversExpand === 1 ? '← Show Less' : 'More Data →'}
                  </button>
                </div>

                {/* Compact list view (top 10) */}
                {moversExpand === 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-1">
                    {allMonthChanges.slice(0, 10).map(r => (
                      <div key={r.partNumber} className="flex items-center justify-between text-xs">
                        <span className="truncate mr-2 text-muted-foreground">{r.partNumber}</span>
                        <span className={`font-semibold whitespace-nowrap ${r.monthValueChange! >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {r.monthValueChange! >= 0 ? '↑' : '↓'}${Math.abs(r.monthValueChange!).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expanded view with horizontal bar chart */}
                {moversExpand === 1 && (() => {
                  const top30 = allMonthChanges.slice(0, 30)
                  const maxAbs = Math.max(...top30.map(r => Math.abs(r.monthValueChange!)))
                  return (
                    <div className="space-y-4 animate-in slide-in-from-top-2 fade-in duration-500">
                      {/* Bar chart */}
                      <div className="space-y-1">
                        {top30.map((r, i) => {
                          const val = r.monthValueChange!
                          const pct = maxAbs > 0 ? (Math.abs(val) / maxAbs) * 100 : 0
                          const isUp = val >= 0
                          return (
                            <div
                              key={r.partNumber}
                              className="flex items-center gap-2 text-xs group hover:bg-muted/30 rounded px-1 py-0.5 transition-colors"
                              style={{ animationDelay: `${i * 30}ms` }}
                            >
                              <span className="w-[120px] truncate text-muted-foreground font-medium flex-shrink-0">{r.partNumber}</span>
                              <div className="flex-1 h-5 bg-muted/30 rounded-full overflow-hidden relative">
                                <div
                                  className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                    isUp
                                      ? 'bg-gradient-to-r from-green-500/60 to-green-400'
                                      : 'bg-gradient-to-r from-red-500/60 to-red-400'
                                  }`}
                                  style={{
                                    width: `${pct}%`,
                                    animation: `bar-grow-${i} 800ms ease-out ${i * 30}ms both`,
                                  }}
                                />
                              </div>
                              <span className={`w-[90px] text-right font-semibold flex-shrink-0 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                                {isUp ? '↑' : '↓'} ${Math.abs(val).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Summary stats */}
                      <div className="grid grid-cols-3 gap-3 pt-2 border-t border-emerald-500/10">
                        <div className="text-center">
                          <p className="text-lg font-bold text-green-400">
                            {top30.filter(r => r.monthValueChange! > 0).length}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Items Up</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-red-400">
                            {top30.filter(r => r.monthValueChange! < 0).length}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Items Down</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold text-emerald-400">
                            ${Math.abs(top30.reduce((sum, r) => sum + r.monthValueChange!, 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Net Change (Top 30)</p>
                        </div>
                      </div>
                      {/* Bottom collapse button */}
                      <div className="flex justify-center pt-2">
                        <button
                          onClick={() => setMoversExpand(0)}
                          className="text-xs px-4 py-1.5 rounded-full bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                        >
                          ← Collapse
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
          </SpotlightCard>
        )}
      </div>
      </ScrollReveal>

      {/* Department Filter (multi-select — none selected = all) */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        <button
          onClick={() => setDeptFilters(new Set())}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            deptFilters.size === 0
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted hover:bg-muted/80'
          }`}
        >
          📋 All
        </button>
        {DEPT_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => toggleDeptFilter(f.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors border ${
              deptFilters.has(f.key)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted hover:bg-muted/80 border-transparent'
            }`}
          >
            {f.emoji} {f.label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="space-y-2 mb-4">
        {/* Search */}
        <input
          type="text"
          placeholder={t('inventory.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full p-2.5 rounded-lg bg-muted border border-border text-sm"
        />

        {/* Stock condition chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STOCK_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setStockFilter(f.key)}
              className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
                stockFilter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              {f.emoji ? `${f.emoji} ` : ''}{t(f.labelKey)}
            </button>
          ))}
        </div>

        {/* Source type chips */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => toggleTypeFilter(f.key)}
              className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors border ${
                typeFilters.has(f.key)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted hover:bg-muted/80 border-transparent'
              }`}
            >
              {f.emoji} {t(f.labelKey)}
            </button>
          ))}

          {/* Clear + Material Requirements */}
          {(deptFilters.size > 0 || stockFilter !== 'all' || typeFilters.size > 0 || search) && (
            <button onClick={clearFilters} className="px-3 py-1 rounded-full text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 whitespace-nowrap">
              ✕ {t('inventory.clearFilters')}
            </button>
          )}
          <Link
            href="/material-requirements"
            className="px-3 py-1 rounded-full text-sm bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 whitespace-nowrap flex items-center gap-1"
          >
            <ExternalLink className="size-3" /> {t('inventory.materialRequirements')}
          </Link>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <TableSkeleton rows={8} />
      )}

      {/* Error */}
      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {/* DataTable */}
      {!loading && !error && (
        <div className="inventory-compact-table">
        <DataTable
          table={table}
          data={filtered}
          noun="item"
          exportFilename="inventory"
          page="inventory"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => row.partNumber}
          onRowClick={(row) => setHistoryPart(row.partNumber)}
          rowClassName={(row) => {
            if (row.status === 'MAKE') return 'bg-red-500/5'
            if (row.status === 'LOW') return 'bg-yellow-500/5'
            return ''
          }}
        />
        </div>
      )}

      {/* History Modal */}
      {historyPart && selectedRow && (
        <HistoryModal
          partNumber={historyPart}
          itemType={selectedRow.itemType}
          currentQty={selectedRow.fusionQty}
          minimum={selectedRow.minimum}
          target={selectedRow.manualTarget}
          onClose={() => setHistoryPart(null)}
        />
      )}
    </div>
  )
}
