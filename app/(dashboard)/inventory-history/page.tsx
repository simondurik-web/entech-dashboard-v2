'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useI18n } from '@/lib/i18n'
import { Card, CardContent } from '@/components/ui/card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceDot,
} from 'recharts'
import type { InventoryItem } from '@/lib/google-sheets-shared'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { useCountUpDecimal } from '@/lib/use-count-up'
import { usePermissions } from '@/lib/use-permissions'

interface InventoryHistoryPart {
  partNumber: string
  dataByDate: Record<string, number>
}

interface InventoryHistoryResponse {
  dates: string[]
  parts: InventoryHistoryPart[]
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

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

const PRODUCT_TYPES = ['All', 'Tire', 'Hub', 'Bearing', 'Finished Part', 'Roll Tech Finished Product', 'Entech/Rubber', 'Molding Feedstock']
const ITEM_TYPES = ['All', 'Manufactured', 'Purchased', 'COM']

type DeptFilterKey = 'molding' | 'rubber' | 'melt'

const DEPT_FILTERS: { key: DeptFilterKey; label: string; emoji: string }[] = [
  { key: 'molding', label: 'Molding', emoji: '🏭' },
  { key: 'rubber', label: 'Rubber', emoji: '♻️' },
  { key: 'melt', label: 'Melt Line', emoji: '🔥' },
]

function parseUsDate(date: string): Date | null {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]))
}

function toDateInputValue(date: string): string {
  const parsed = parseUsDate(date)
  if (!parsed) return ''
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

/** Return one date per month — the earliest date in that month from the dataset */
function getMonthStartDates(dates: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const d of dates) {
    const parsed = parseUsDate(d)
    if (!parsed) continue
    const key = `${parsed.getFullYear()}-${parsed.getMonth()}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(d)
    }
  }
  return result
}

// Custom gradient area chart with animation
function ValueChart({
  data,
  monthStartDates,
  animationActive,
}: {
  data: { date: string; value: number }[]
  monthStartDates: string[]
  animationActive: boolean
}) {
  const gradientId = useRef(`value-gradient-${Math.random().toString(36).slice(2)}`).current
  const strokeId = useRef(`value-stroke-${Math.random().toString(36).slice(2)}`).current

  if (!data.length) return null

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
            <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="50%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" strokeOpacity={0.3} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#6b7280' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgba(15,23,42,0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(148,163,184,0.2)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            fontSize: '12px',
            color: '#e2e8f0',
          }}
          formatter={(value: number | undefined) => [`$${(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Inventory Value']}
          labelFormatter={(label: unknown) => `📅 ${label}`}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={`url(#${strokeId})`}
          strokeWidth={2.5}
          fill={`url(#${gradientId})`}
          animationBegin={0}
          animationDuration={animationActive ? 2000 : 0}
          animationEasing="ease-out"
          dot={false}
        />
        {/* Month-start dots */}
        {monthStartDates.map((date) => {
          const point = data.find(d => d.date === date)
          if (!point) return null
          return (
            <ReferenceDot
              key={date}
              x={date}
              y={point.value}
              r={5}
              fill="#f59e0b"
              stroke="#fff"
              strokeWidth={2}
            />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export default function InventoryHistoryPage() {
  const { t } = useI18n()
  const [history, setHistory] = useState<InventoryHistoryResponse>({ dates: [], parts: [] })
  const [inventoryMap, setInventoryMap] = useState<Map<string, InventoryItem>>(new Map())
  const [costData, setCostData] = useState<Record<string, CostEntry>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedParts, setSelectedParts] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [productTypes, setProductTypes] = useState<Set<string>>(new Set(['All']))
  const [itemTypes, setItemTypes] = useState<Set<string>>(new Set(['All']))
  const [deptFilters, setDeptFilters] = useState<Set<DeptFilterKey>>(new Set())
  const [chartAnimated, setChartAnimated] = useState(false)
  const { canAccess } = usePermissions()
  const showCosts = canAccess('view_inventory_values')

  useEffect(() => {
    Promise.all([
      fetch('/api/inventory-history').then((r) => {
        if (!r.ok) throw new Error('Failed to fetch history')
        return r.json() as Promise<InventoryHistoryResponse>
      }),
      fetch('/api/inventory').then((r) => {
        if (!r.ok) throw new Error('Failed to fetch inventory')
        return r.json() as Promise<InventoryItem[]>
      }),
      showCosts ? fetch('/api/inventory-costs').then(r => r.ok ? r.json() : { costs: {} }) : Promise.resolve({ costs: {} }),
    ])
      .then(([histData, invData, costRes]) => {
        const sortedDates = [...histData.dates].sort((a, b) => {
          const da = parseUsDate(a)?.getTime() ?? 0
          const db = parseUsDate(b)?.getTime() ?? 0
          return da - db
        })
        const latestDate = sortedDates[sortedDates.length - 1]
        const sortedParts = [...histData.parts].sort(
          (a, b) => (b.dataByDate[latestDate] ?? 0) - (a.dataByDate[latestDate] ?? 0)
        )
        setHistory({ dates: sortedDates, parts: sortedParts })
        if (sortedDates.length > 0) {
          setStartDate(toDateInputValue(sortedDates[0]))
          setEndDate(toDateInputValue(sortedDates[sortedDates.length - 1]))
        }

        const map = new Map<string, InventoryItem>()
        for (const item of invData) map.set(item.partNumber, item)
        setInventoryMap(map)

        setCostData(costRes.costs ?? {})

        // Trigger chart animation after data loads
        requestAnimationFrame(() => setChartAnimated(true))
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [showCosts])

  const toggleDeptFilter = useCallback((key: DeptFilterKey) => {
    setDeptFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])

  const toggleProductType = useCallback((pt: string) => {
    setProductTypes((prev) => {
      const next = new Set(prev)
      if (pt === 'All') return new Set(['All'])
      next.delete('All')
      if (next.has(pt)) { next.delete(pt); if (next.size === 0) return new Set(['All']) }
      else next.add(pt)
      return next
    })
  }, [])

  const toggleItemType = useCallback((it: string) => {
    setItemTypes((prev) => {
      const next = new Set(prev)
      if (it === 'All') return new Set(['All'])
      next.delete('All')
      if (next.has(it)) { next.delete(it); if (next.size === 0) return new Set(['All']) }
      else next.add(it)
      return next
    })
  }, [])

  // Filter parts by department, product type, item type, search
  const filteredParts = useMemo(() => {
    const term = searchTerm.toLowerCase()
    return history.parts.filter((p) => {
      if (term && !p.partNumber.toLowerCase().includes(term)) return false
      const inv = inventoryMap.get(p.partNumber)

      // Department filter
      if (deptFilters.size > 0) {
        const costEntry = costData[p.partNumber] || costData[p.partNumber.replace(/^0+/, '')]
        const dept = (costEntry?.department || '').toLowerCase()
        let match = false
        if (deptFilters.has('molding') && (dept.includes('molding') || dept.includes('compression'))) match = true
        if (deptFilters.has('rubber') && dept.includes('rubber')) match = true
        if (deptFilters.has('melt') && dept.includes('melt')) match = true
        if (!match) return false
      }

      if (!productTypes.has('All')) {
        if (!inv || !productTypes.has(inv.product)) return false
      }
      if (!itemTypes.has('All')) {
        if (!inv || !itemTypes.has(inv.itemType)) return false
      }
      return true
    })
  }, [history.parts, searchTerm, productTypes, itemTypes, inventoryMap, deptFilters, costData])

  const selectedItems = useMemo(
    () => history.parts.filter((p) => selectedParts.includes(p.partNumber)),
    [history.parts, selectedParts]
  )

  const rangeDates = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY
    const endMs = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY
    return history.dates.filter((date) => {
      const ms = parseUsDate(date)?.getTime()
      if (ms === undefined) return false
      return ms >= startMs && ms <= endMs
    })
  }, [history.dates, startDate, endDate])

  // Overview chart: total $ value over time for filtered parts
  const overviewChartData = useMemo(() => {
    if (!showCosts) return []
    return rangeDates.map(date => {
      let total = 0
      for (const part of filteredParts) {
        const qty = part.dataByDate[date] ?? 0
        const costEntry = costData[part.partNumber] || costData[part.partNumber.replace(/^0+/, '')]
        const uc = costEntry?.lowerCost ?? costEntry?.cost ?? null
        if (uc != null) total += qty * uc
      }
      return { date, value: Math.round(total * 100) / 100 }
    })
  }, [rangeDates, filteredParts, costData, showCosts])

  // Month-start dates for dots (one per month — earliest date in each month)
  const monthStartDates = useMemo(() => {
    return getMonthStartDates(rangeDates)
  }, [rangeDates])

  // Current total value for animated counter
  const currentTotalValue = overviewChartData.length ? overviewChartData[overviewChartData.length - 1].value : 0
  const animatedTotalValue = useCountUpDecimal(currentTotalValue)

  // Per-item chart data (qty + $ value)
  const itemChartData = useMemo(() => {
    return rangeDates.map((date) => {
      const row: Record<string, string | number> = { date }
      for (const item of selectedItems) {
        const qty = item.dataByDate[date] ?? 0
        row[item.partNumber] = qty
        // Also add value line
        const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
        const uc = costEntry?.lowerCost ?? costEntry?.cost ?? null
        row[`${item.partNumber}_value`] = uc != null ? Math.round(qty * uc * 100) / 100 : 0
      }
      return row
    })
  }, [rangeDates, selectedItems, costData])

  const statsByPart = useMemo(() => {
    return selectedItems.map((item) => {
      const values = rangeDates.map((date) => item.dataByDate[date] ?? 0)
      const current = values.length ? values[values.length - 1] : 0
      const first = values.length ? values[0] : 0
      const change = current - first
      const changePct = first !== 0 ? ((change / first) * 100) : 0
      const inv = inventoryMap.get(item.partNumber)
      const costEntry = costData[item.partNumber] || costData[item.partNumber.replace(/^0+/, '')]
      const uc = costEntry?.lowerCost ?? costEntry?.cost ?? null
      return {
        partNumber: item.partNumber,
        current,
        change,
        changePct,
        inStock: inv?.inStock ?? current,
        minimum: inv?.minimum ?? 0,
        target: inv?.target ?? 0,
        unitCost: uc,
        totalValue: uc != null ? current * uc : null,
      }
    })
  }, [selectedItems, rangeDates, inventoryMap, costData])

  const togglePart = useCallback((partNumber: string) => {
    setSelectedParts((prev) =>
      prev.includes(partNumber)
        ? prev.filter((p) => p !== partNumber)
        : prev.length < 5
          ? [...prev, partNumber]
          : prev
    )
  }, [])

  if (loading) return <TableSkeleton rows={8} />
  if (error) return <p className="text-center text-destructive py-10">{error}</p>

  return (
    <div className="p-4 pb-20 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">📈 {t('page.inventoryHistory')}</h1>
        <p className="text-muted-foreground text-sm">{t('inventoryHistory.trackStock')}</p>
      </div>

      {/* Department Filter (multi-select) */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setDeptFilters(new Set())}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            deptFilters.size === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
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

      {/* Overview Value Chart */}
      {showCosts && overviewChartData.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-muted-foreground">💰 Total Inventory Value{deptFilters.size > 0 ? ` — ${[...deptFilters].map(k => DEPT_FILTERS.find(f => f.key === k)?.label).filter(Boolean).join(', ')}` : ''}</p>
                <p className="text-2xl font-bold text-emerald-400">
                  ${animatedTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Month start
                </span>
              </div>
            </div>
            <div className="h-[220px]">
              <ValueChart
                data={overviewChartData}
                monthStartDates={monthStartDates}
                animationActive={chartAnimated}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PRODUCT_TYPES.map((pt) => (
            <button
              key={pt}
              onClick={() => toggleProductType(pt)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                productTypes.has(pt)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {pt}
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="flex flex-wrap gap-1">
          {ITEM_TYPES.map((it) => (
            <button
              key={it}
              onClick={() => toggleItemType(it)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                itemTypes.has(it)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              {it}
            </button>
          ))}
        </div>
        <div className="w-px h-6 bg-border" />
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); if (endDate && e.target.value > endDate) setEndDate(e.target.value) }}
            className="px-2 py-1.5 text-xs border rounded-md bg-background"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); if (startDate && e.target.value < startDate) setStartDate(e.target.value) }}
            className="px-2 py-1.5 text-xs border rounded-md bg-background"
          />
        </div>
      </div>

      {/* Main content: parts list + chart */}
      <div className="grid lg:grid-cols-10 gap-4">
        {/* Parts list — 30% */}
        <Card className="lg:col-span-3">
          <CardContent className="p-3">
            <input
              type="text"
              placeholder={t('inventoryHistory.searchParts')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border rounded-md bg-background mb-2"
            />
            <div className="text-[10px] text-muted-foreground mb-2">
              {selectedParts.length}/5 {t('inventoryHistory.selected')} · {filteredParts.length} {t('inventoryHistory.parts')}
            </div>
            <div className="max-h-[500px] overflow-y-auto space-y-0.5">
              {filteredParts.map((item) => {
                const isSelected = selectedParts.includes(item.partNumber)
                const colorIdx = selectedParts.indexOf(item.partNumber)
                const latestQty = history.dates.length
                  ? item.dataByDate[history.dates[history.dates.length - 1]] ?? 0
                  : 0
                const inv = inventoryMap.get(item.partNumber)

                return (
                  <button
                    key={item.partNumber}
                    onClick={() => togglePart(item.partNumber)}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors flex items-center gap-1.5 ${
                      isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted'
                    }`}
                  >
                    {isSelected && (
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[colorIdx] }} />
                    )}
                    <span className="truncate">{item.partNumber}</span>
                    {inv && <span className="text-[10px] text-muted-foreground truncate ml-1">{inv.product}</span>}
                    <span className="ml-auto text-[10px] text-muted-foreground flex-shrink-0">{latestQty.toLocaleString()}</span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Chart — 70% */}
        <Card className="lg:col-span-7">
          <CardContent className="p-4">
            {selectedParts.length === 0 ? (
              <div className="flex items-center justify-center h-[500px] text-muted-foreground text-sm">
                ← {t('inventoryHistory.selectParts')}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Quantity chart */}
                <div>
                  <p className="text-xs text-muted-foreground mb-2">📊 Quantity Over Time</p>
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={itemChartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" strokeOpacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'rgba(15,23,42,0.95)',
                            backdropFilter: 'blur(12px)',
                            border: '1px solid rgba(148,163,184,0.2)',
                            borderRadius: '10px',
                            fontSize: '12px',
                            color: '#e2e8f0',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        {selectedParts.map((part, idx) => (
                          <Line
                            key={part}
                            type="monotone"
                            dataKey={part}
                            name={`${part} (qty)`}
                            stroke={COLORS[idx]}
                            strokeWidth={2}
                            dot={false}
                            animationBegin={200 + idx * 150}
                            animationDuration={800}
                            animationEasing="ease-out"
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Value chart */}
                {showCosts && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">💰 Dollar Value Over Time</p>
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={itemChartData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" strokeOpacity={0.3} />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                          <YAxis
                            tick={{ fontSize: 10 }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'rgba(15,23,42,0.95)',
                              backdropFilter: 'blur(12px)',
                              border: '1px solid rgba(148,163,184,0.2)',
                              borderRadius: '10px',
                              fontSize: '12px',
                              color: '#e2e8f0',
                            }}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={(value: any, name: any) => [
                              `$${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                              String(name || '').replace('_value', ''),
                            ]}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                          {selectedParts.map((part, idx) => (
                            <Line
                              key={`${part}_value`}
                              type="monotone"
                              dataKey={`${part}_value`}
                              name={`${part} ($)`}
                              stroke={COLORS[idx]}
                              strokeWidth={2}
                              strokeDasharray="6 3"
                              dot={false}
                              animationBegin={200 + idx * 150}
                              animationDuration={800}
                              animationEasing="ease-out"
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stat cards for selected parts */}
      {statsByPart.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {statsByPart.map((item, idx) => (
            <Card key={item.partNumber} className="border-l-4" style={{ borderLeftColor: COLORS[idx] }}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground truncate font-medium">{item.partNumber}</p>
                <p className="text-xl font-bold mt-1">{item.inStock.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{t('inventoryHistory.currentStock')}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <span className={`text-sm font-semibold ${item.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {item.change >= 0 ? '↑' : '↓'} {Math.abs(item.change).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    ({item.changePct >= 0 ? '+' : ''}{item.changePct.toFixed(1)}%)
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-1.5">{t('inventoryHistory.overPeriod')}</p>
                <div className="border-t border-border/40 pt-1.5 space-y-0.5">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">{t('table.minimum')}</span>
                    <span className={`font-medium ${item.minimum > 0 && item.inStock < item.minimum ? 'text-red-400' : ''}`}>
                      {item.minimum > 0 ? item.minimum.toLocaleString() : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">{t('inventoryHistory.manualTarget')}</span>
                    <span className="font-medium">{item.target > 0 ? item.target.toLocaleString() : '—'}</span>
                  </div>
                  {showCosts && item.totalValue != null && (
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">💰 Value</span>
                      <span className="font-medium text-emerald-400">
                        ${item.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
