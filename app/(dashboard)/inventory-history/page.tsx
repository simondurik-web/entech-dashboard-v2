'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'

interface InventoryHistoryPart {
  partNumber: string
  dataByDate: Record<string, number>
}

interface InventoryHistoryResponse {
  dates: string[]
  parts: InventoryHistoryPart[]
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

function parseUsDate(date: string): Date | null {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!match) return null
  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  return new Date(year, month - 1, day)
}

function toDateInputValue(date: string): string {
  const parsed = parseUsDate(date)
  if (!parsed) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function InventoryHistoryPage() {
  const [history, setHistory] = useState<InventoryHistoryResponse>({ dates: [], parts: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedParts, setSelectedParts] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    fetch('/api/inventory-history')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch inventory history')
        return res.json()
      })
      .then((data: InventoryHistoryResponse) => {
        const sortedDates = [...data.dates].sort((a, b) => {
          const da = parseUsDate(a)?.getTime() ?? 0
          const db = parseUsDate(b)?.getTime() ?? 0
          return da - db
        })

        const latestDate = sortedDates[sortedDates.length - 1]
        const sortedParts = [...data.parts].sort(
          (a, b) => (b.dataByDate[latestDate] ?? 0) - (a.dataByDate[latestDate] ?? 0)
        )

        setHistory({ dates: sortedDates, parts: sortedParts })
        setSelectedParts(sortedParts.slice(0, 3).map((p) => p.partNumber))

        if (sortedDates.length > 0) {
          setStartDate(toDateInputValue(sortedDates[0]))
          setEndDate(toDateInputValue(sortedDates[sortedDates.length - 1]))
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filteredParts = useMemo(
    () =>
      history.parts.filter((item) =>
        item.partNumber.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [history.parts, searchTerm]
  )

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
      const min = values.length ? Math.min(...values) : 0
      const max = values.length ? Math.max(...values) : 0
      const avg = values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : 0

      return {
        partNumber: item.partNumber,
        current,
        min,
        max,
        avg,
      }
    })
  }, [selectedItems, rangeDates])

  const comparisonData = statsByPart.map((item) => ({
    name: item.partNumber.length > 15 ? `${item.partNumber.slice(0, 15)}...` : item.partNumber,
    current: item.current,
    min: item.min,
    max: item.max,
  }))

  const togglePart = (partNumber: string) => {
    setSelectedParts((prev) =>
      prev.includes(partNumber)
        ? prev.filter((p) => p !== partNumber)
        : prev.length < 5
          ? [...prev, partNumber]
          : prev
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return <p className="text-center text-destructive py-10">{error}</p>
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📈 Inventory History</h1>
      <p className="text-muted-foreground text-sm mb-4">Track stock levels over time</p>

      <div className="grid lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Select Parts (max 5)</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="text"
              placeholder="Search parts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-md bg-background mb-3"
            />
            <div className="max-h-[400px] overflow-y-auto space-y-1">
              {filteredParts.slice(0, 50).map((item) => {
                const isSelected = selectedParts.includes(item.partNumber)
                const colorIdx = selectedParts.indexOf(item.partNumber)
                const latestQty = history.dates.length
                  ? item.dataByDate[history.dates[history.dates.length - 1]] ?? 0
                  : 0

                return (
                  <button
                    key={item.partNumber}
                    onClick={() => togglePart(item.partNumber)}
                    className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2 ${
                      isSelected
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {isSelected && (
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[colorIdx] }}
                      />
                    )}
                    <span className="truncate">{item.partNumber}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{latestQty}</span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Date Range</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="block mb-1 text-muted-foreground">Start date</span>
                  <input
                    type="date"
                    value={startDate}
                    min={history.dates[0] ? toDateInputValue(history.dates[0]) : undefined}
                    max={endDate || (history.dates.length ? toDateInputValue(history.dates[history.dates.length - 1]) : undefined)}
                    onChange={(e) => {
                      const next = e.target.value
                      setStartDate(next)
                      if (endDate && next > endDate) setEndDate(next)
                    }}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                  />
                </label>
                <label className="text-sm">
                  <span className="block mb-1 text-muted-foreground">End date</span>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || (history.dates[0] ? toDateInputValue(history.dates[0]) : undefined)}
                    max={history.dates.length ? toDateInputValue(history.dates[history.dates.length - 1]) : undefined}
                    onChange={(e) => {
                      const next = e.target.value
                      setEndDate(next)
                      if (startDate && next < startDate) setStartDate(next)
                    }}
                    className="w-full px-3 py-2 text-sm border rounded-md bg-background"
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Inventory Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedParts.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">
                  Select parts from the left panel to view trends
                </p>
              ) : (
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" className="text-xs" />
                      <YAxis className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      {selectedParts.map((part, idx) => (
                        <Line
                          key={part}
                          type="monotone"
                          dataKey={part}
                          stroke={COLORS[idx]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Current vs Min/Max</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedParts.length === 0 ? (
                <p className="text-center text-muted-foreground py-10">
                  Select parts to compare stock levels
                </p>
              ) : (
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" className="text-xs" />
                      <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--background))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <Bar dataKey="current" name="Current" fill="#3b82f6" />
                      <Bar dataKey="min" name="Min" fill="#ef4444" />
                      <Bar dataKey="max" name="Max" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {statsByPart.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {statsByPart.map((item, idx) => (
                <Card
                  key={item.partNumber}
                  className="border-l-4"
                  style={{ borderLeftColor: COLORS[idx] }}
                >
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground truncate">{item.partNumber}</p>
                    <p className="text-lg font-semibold">Current: {item.current.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Min: {item.min.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Max: {item.max.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Avg: {item.avg.toFixed(1)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
