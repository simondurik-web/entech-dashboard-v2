'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
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
} from 'recharts'
import type { InventoryItem } from '@/lib/google-sheets'
import { TableSkeleton } from "@/components/ui/skeleton-loader"

interface InventoryHistoryPart {
  partNumber: string
  dataByDate: Record<string, number>
}

interface InventoryHistoryResponse {
  dates: string[]
  parts: InventoryHistoryPart[]
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

const PRODUCT_TYPES = ['All', 'Tire', 'Hub', 'Bearing', 'Finished Part', 'Roll Tech Finished Product', 'Entech/Rubber', 'Molding Feedstock']
const ITEM_TYPES = ['All', 'Manufactured', 'Purchased', 'COM']

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

export default function InventoryHistoryPage() {
  const { t } = useI18n()
  const [history, setHistory] = useState<InventoryHistoryResponse>({ dates: [], parts: [] })
  const [inventoryMap, setInventoryMap] = useState<Map<string, InventoryItem>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedParts, setSelectedParts] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [productTypes, setProductTypes] = useState<Set<string>>(new Set(['All']))
  const [itemTypes, setItemTypes] = useState<Set<string>>(new Set(['All']))

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
    ])
      .then(([histData, invData]) => {
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
        // Start with no parts selected — user picks what they want
        if (sortedDates.length > 0) {
          setStartDate(toDateInputValue(sortedDates[0]))
          setEndDate(toDateInputValue(sortedDates[sortedDates.length - 1]))
        }

        const map = new Map<string, InventoryItem>()
        for (const item of invData) map.set(item.partNumber, item)
        setInventoryMap(map)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const toggleProductType = useCallback((pt: string) => {
    setProductTypes((prev) => {
      const next = new Set(prev)
      if (pt === 'All') return new Set(['All'])
      next.delete('All')
      if (next.has(pt)) {
        next.delete(pt)
        if (next.size === 0) return new Set(['All'])
      } else {
        next.add(pt)
      }
      return next
    })
  }, [])

  const toggleItemType = useCallback((it: string) => {
    setItemTypes((prev) => {
      const next = new Set(prev)
      if (it === 'All') return new Set(['All'])
      next.delete('All')
      if (next.has(it)) {
        next.delete(it)
        if (next.size === 0) return new Set(['All'])
      } else {
        next.add(it)
      }
      return next
    })
  }, [])

  const filteredParts = useMemo(() => {
    const term = searchTerm.toLowerCase()
    return history.parts.filter((p) => {
      if (term && !p.partNumber.toLowerCase().includes(term)) return false
      const inv = inventoryMap.get(p.partNumber)
      if (!productTypes.has('All')) {
        if (!inv || !productTypes.has(inv.product)) return false
      }
      if (!itemTypes.has('All')) {
        if (!inv || !itemTypes.has(inv.itemType)) return false
      }
      return true
    })
  }, [history.parts, searchTerm, productTypes, itemTypes, inventoryMap])

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

  const chartData = useMemo(() => {
    return rangeDates.map((date) => {
      const row: Record<string, string | number> = { date }
      for (const item of selectedItems) {
        row[item.partNumber] = item.dataByDate[date] ?? 0
      }
      return row
    })
  }, [rangeDates, selectedItems])

  const statsByPart = useMemo(() => {
    return selectedItems.map((item) => {
      const values = rangeDates.map((date) => item.dataByDate[date] ?? 0)
      const current = values.length ? values[values.length - 1] : 0
      const first = values.length ? values[0] : 0
      const change = current - first
      const changePct = first !== 0 ? ((change / first) * 100) : 0
      const inv = inventoryMap.get(item.partNumber)
      return {
        partNumber: item.partNumber,
        current,
        change,
        changePct,
        inStock: inv?.inStock ?? current,
        minimum: inv?.minimum ?? 0,
        target: inv?.target ?? 0,
      }
    })
  }, [selectedItems, rangeDates, inventoryMap])

  const togglePart = useCallback((partNumber: string) => {
    setSelectedParts((prev) =>
      prev.includes(partNumber)
        ? prev.filter((p) => p !== partNumber)
        : prev.length < 5
          ? [...prev, partNumber]
          : prev
    )
  }, [])

  if (loading) {
    return (
      <TableSkeleton rows={8} />
    )
  }

  if (error) {
    return <p className="text-center text-destructive py-10">{error}</p>
  }

  return (
    <div className="p-4 pb-20 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">📈 {t('page.inventoryHistory')}</h1>
        <p className="text-muted-foreground text-sm">{t('inventoryHistory.trackStock')}</p>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Product Type chips (multi-select) */}
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

        {/* Item Type chips (multi-select) */}
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

        {/* Date range */}
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
                      isSelected
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {isSelected && (
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[colorIdx] }}
                      />
                    )}
                    <span className="truncate">{item.partNumber}</span>
                    {inv && (
                      <span className="text-[10px] text-muted-foreground truncate ml-1">
                        {inv.product}
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-muted-foreground flex-shrink-0">{latestQty}</span>
                  </button>
                )
              })}
            </div>
            {/* All parts shown — just scroll */}
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
              <div className="h-[500px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" tick={{ fontSize: 11 }} />
                    <YAxis className="text-xs" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card) / 0.8)',
                        backdropFilter: 'blur(12px)',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '10px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                        fontSize: '12px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    {selectedParts.map((part, idx) => (
                      <Line
                        key={part}
                        type="monotone"
                        dataKey={part}
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stat cards for selected parts */}
      {statsByPart.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {statsByPart.map((item, idx) => (
            <Card
              key={item.partNumber}
              className="border-l-4"
              style={{ borderLeftColor: COLORS[idx] }}
            >
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
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
