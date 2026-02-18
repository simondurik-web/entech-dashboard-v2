'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, X, ExternalLink } from 'lucide-react'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { InventoryItem, InventoryHistoryData } from '@/lib/google-sheets'
import Link from 'next/link'

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
  // raw fields for filtering
  _raw: InventoryItem
}

interface HistoryData {
  dates: string[]
  dataByDate: Record<string, number>
}

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

const STOCK_FILTERS: { key: StockFilterKey; label: string; emoji?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low Stock', emoji: '⚠️' },
  { key: 'production', label: 'Needs Production', emoji: '🔧' },
  { key: 'running-low', label: 'Running Low', emoji: '🔥' },
]

const TYPE_FILTERS: { key: TypeFilterKey; label: string; emoji: string }[] = [
  { key: 'manufactured', label: 'Manufactured', emoji: '🏭' },
  { key: 'purchased', label: 'Purchased', emoji: '🛒' },
  { key: 'com', label: 'COM', emoji: '📦' },
]

// ─── Column Definitions ───

function makeColumns(onHistoryClick: (partNumber: string) => void): ColumnDef<InventoryRow>[] {
  return [
    { key: 'product', label: 'Product Type', sortable: true, filterable: true },
    {
      key: 'partNumber', label: 'Part Number', sortable: true, filterable: true,
      render: (v) => (
        <span className="font-bold">{String(v)}</span>
      ),
    },
    { key: 'fusionQty', label: 'Fusion Qty', sortable: true, render: (v) => Number(v).toLocaleString() },
    { key: 'minimum', label: 'Minimum', sortable: true, render: (v) => Number(v).toLocaleString() },
    { key: 'manualTarget', label: 'Manual Target', sortable: true, render: (v) => Number(v).toLocaleString() },
    { key: 'qtyNeeded', label: 'Qty Needed', sortable: true, render: (v) => Number(v).toLocaleString() },
    {
      key: 'partsToBeMade', label: 'Parts to Make', sortable: true,
      render: (v) => {
        const n = Number(v)
        return <span className={n > 0 ? 'text-red-400 font-semibold' : ''}>{n.toLocaleString()}</span>
      },
    },
    { key: 'moldType', label: 'Mold Type', sortable: true, filterable: true },
    {
      key: 'avgUsage', label: 'Avg Usage/Day', sortable: true,
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
      key: 'trend', label: 'Trend', sortable: true,
      render: (v, row) => <span className={String(row.trendColor)}>{String(v)}</span>,
    },
    {
      key: 'daysToMin', label: 'Days to Min', sortable: true,
      render: (v) => {
        if (v == null) return '-'
        const n = Number(v)
        const color = n < 14 ? 'text-red-400' : n < 30 ? 'text-yellow-400' : 'text-green-400'
        return <span className={color}>{n}d</span>
      },
    },
    {
      key: 'daysToZero', label: 'Days to Zero', sortable: true,
      render: (v, row) => {
        if (row.isManufactured) return <span className="text-muted-foreground">-</span>
        if (v == null) return '-'
        const n = Number(v)
        const color = n < 14 ? 'text-red-400' : n < 30 ? 'text-yellow-400' : 'text-green-400'
        return <span className={color}>{n}d</span>
      },
    },
    {
      key: 'status', label: 'Status', sortable: true, filterable: true,
      render: (v) => {
        const s = String(v)
        if (s === 'MAKE') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400">MAKE</span>
        if (s === 'LOW') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400">LOW</span>
        return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">OK</span>
      },
    },
    {
      key: 'itemType', label: 'Item Type', sortable: true, filterable: true,
      render: (v) => {
        const t = String(v)
        if (t === 'Manufactured') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-400">🏭 Manufactured</span>
        if (t === 'Purchased') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/20 text-green-400">🛒 Purchased</span>
        if (t === 'COM') return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-500/20 text-orange-400">📦 COM</span>
        return <span className="text-muted-foreground">{t || '-'}</span>
      },
    },
  ]
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
          <h2 className="text-xl font-bold">📈 Inventory History — {partNumber}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700 transition-colors"><X className="size-5" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : !historyData ? (
          <p className="text-center text-muted-foreground py-10">No history data found for {partNumber}</p>
        ) : (
          <>
            {/* Date Range Controls */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <div>
                <label className="text-xs text-muted-foreground">Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="block mt-1 px-3 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-sm" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">End Date</label>
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
                <p className="text-xs text-muted-foreground">Current Qty</p>
                <p className="text-lg font-bold">{currentQty.toLocaleString()}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Minimum Threshold</p>
                <p className="text-lg font-bold">{minimum.toLocaleString()}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Historical Max</p>
                <p className="text-lg font-bold">{stats?.max.toLocaleString() ?? '-'}</p>
              </div>
              <div className="bg-zinc-800 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Average</p>
                <p className="text-lg font-bold">{stats?.avg.toLocaleString() ?? '-'}</p>
              </div>
            </div>

            {/* Usage/Production Stats */}
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? '7-Day Avg Made/day' : '7-Day Avg Usage/day'}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg
                      ? ((stats as { prod7: number | null }).prod7?.toFixed(1) ?? '-')
                      : ((stats as { usage7: number | null }).usage7?.toFixed(1) ?? '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? '30-Day Avg Made/day' : '30-Day Avg Usage/day'}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg
                      ? ((stats as { prod30: number | null }).prod30?.toFixed(1) ?? '-')
                      : ((stats as { usage30: number | null }).usage30?.toFixed(1) ?? '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? 'Days to Target' : 'Days to Minimum'}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg
                      ? ((stats as { daysToTarget: number | null }).daysToTarget != null ? `${(stats as { daysToTarget: number }).daysToTarget}d` : '-')
                      : ((stats as { daysToMin: number | null }).daysToMin != null ? `${(stats as { daysToMin: number }).daysToMin}d` : '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? 'N/A' : 'Days to Zero'}</p>
                  <p className="text-lg font-bold">
                    {stats.isMfg ? '-' : ((stats as { daysToZero: number | null }).daysToZero != null ? `${(stats as { daysToZero: number }).daysToZero}d` : '-')}
                  </p>
                </div>
                <div className="bg-zinc-800 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{stats.isMfg ? 'Production Trend' : 'Usage Trend'}</p>
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
  const [items, setItems] = useState<InventoryItem[]>([])
  const [historyData, setHistoryData] = useState<InventoryHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stockFilter, setStockFilter] = useState<StockFilterKey>('all')
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilterKey>>(new Set())
  const [search, setSearch] = useState('')
  const [historyPart, setHistoryPart] = useState<string | null>(null)

  const toggleTypeFilter = (key: TypeFilterKey) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const clearFilters = () => {
    setStockFilter('all')
    setTypeFilters(new Set())
    setSearch('')
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const [invRes, histRes] = await Promise.all([
        fetch('/api/inventory'),
        fetch('/api/inventory-history'),
      ])
      if (!invRes.ok) throw new Error('Failed to fetch inventory')
      const invData: InventoryItem[] = await invRes.json()
      setItems(invData)
      if (histRes.ok) {
        const hd: InventoryHistoryData = await histRes.json()
        setHistoryData(hd)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

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
        _raw: item,
      }
    })
  }, [items, historyData])

  // Apply filters
  const filtered = useMemo(() => {
    let result = rows

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
  }, [rows, stockFilter, typeFilters, search])

  // Stats
  const totalItems = rows.length
  const productTypes = new Set(rows.map(r => r.product)).size
  const lowStock = rows.filter(r => r.fusionQty < r.minimum && r.minimum > 0).length
  const needsProduction = rows.filter(r => r.partsToBeMade > 0).length
  const adequateStock = rows.filter(r => r.fusionQty >= r.minimum || r.minimum === 0).length

  const columns = useMemo(() => makeColumns(setHistoryPart), [])

  const table = useDataTable({
    data: filtered,
    columns,
    storageKey: 'inventory',
  })

  // Find selected part for modal
  const selectedRow = historyPart ? rows.find(r => r.partNumber === historyPart) : null

  return (
    <div className="p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📦 Inventory</h1>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">Inventory levels, usage forecasting & trend analysis</p>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3 border border-zinc-700/50" style={{ borderImage: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(139,92,246,0.3)) 1' }}>
          <p className="text-xs text-muted-foreground">Total Items</p>
          <p className="text-xl font-bold">{totalItems}</p>
          <p className="text-[10px] text-muted-foreground">{productTypes} product types</p>
        </div>
        <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
          <p className="text-xs text-red-400">Low Stock</p>
          <p className="text-xl font-bold text-red-400">{lowStock}</p>
        </div>
        <div className="bg-yellow-500/10 rounded-lg p-3 border border-yellow-500/20">
          <p className="text-xs text-yellow-400">Needs Production</p>
          <p className="text-xl font-bold text-yellow-400">{needsProduction}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/20">
          <p className="text-xs text-green-400">Adequate Stock</p>
          <p className="text-xl font-bold text-green-400">{adequateStock}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="space-y-2 mb-4">
        {/* Search */}
        <input
          type="text"
          placeholder="Search by part number or product..."
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
              {f.emoji ? `${f.emoji} ` : ''}{f.label}
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
              {f.emoji} {f.label}
            </button>
          ))}

          {/* Clear + Material Requirements */}
          {(stockFilter !== 'all' || typeFilters.size > 0 || search) && (
            <button onClick={clearFilters} className="px-3 py-1 rounded-full text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 whitespace-nowrap">
              ✕ Clear Filters
            </button>
          )}
          <Link
            href="/material-requirements"
            className="px-3 py-1 rounded-full text-sm bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 whitespace-nowrap flex items-center gap-1"
          >
            <ExternalLink className="size-3" /> Material Requirements
          </Link>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error */}
      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {/* DataTable */}
      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun="item"
          exportFilename="inventory"
          getRowKey={(row) => row.partNumber}
          onRowClick={(row) => setHistoryPart(row.partNumber)}
          rowClassName={(row) => {
            if (row.status === 'MAKE') return 'bg-red-500/5'
            if (row.status === 'LOW') return 'bg-yellow-500/5'
            return ''
          }}
        />
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
