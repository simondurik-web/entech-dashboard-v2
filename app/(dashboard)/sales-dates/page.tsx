'use client'

import { useEffect, useState, useMemo } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

interface SalesOrder {
  line: string
  customer: string
  partNumber: string
  category: string
  qty: number
  revenue: number
  variableCost: number
  totalCost: number
  pl: number
  shippedDate: string
  status: string
}

interface SalesData {
  orders: SalesOrder[]
  summary: { totalRevenue: number; totalCosts: number; totalPL: number; avgMargin: number; orderCount: number }
}

interface MonthSummary {
  monthKey: string
  monthLabel: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
}

type SortField = 'monthKey' | 'orderCount' | 'totalQty' | 'revenue' | 'costs' | 'pl' | 'margin'

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

function getMonthKey(dateStr: string): string | null {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length < 3) return null
  const year = parts[2].length === 2 ? '20' + parts[2] : parts[2]
  return `${year}-${parts[0].padStart(2, '0')}`
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${year}`
}

export default function SalesDatesPage() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('monthKey')
  const [sortAsc, setSortAsc] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/sales')
        if (!res.ok) throw new Error('Failed to fetch sales data')
        const salesData = await res.json()
        setData(salesData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const monthSummaries = useMemo(() => {
    if (!data) return []
    
    const byMonth: Record<string, MonthSummary> = {}
    
    for (const order of data.orders) {
      const monthKey = getMonthKey(order.shippedDate)
      if (!monthKey) continue
      
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = {
          monthKey,
          monthLabel: getMonthLabel(monthKey),
          orderCount: 0,
          totalQty: 0,
          revenue: 0,
          costs: 0,
          pl: 0,
          margin: 0,
        }
      }
      byMonth[monthKey].orderCount++
      byMonth[monthKey].totalQty += order.qty
      byMonth[monthKey].revenue += order.revenue
      byMonth[monthKey].costs += order.totalCost || order.variableCost
      byMonth[monthKey].pl += order.pl
    }
    
    // Calculate margin and sort
    let summaries = Object.values(byMonth).map((m) => ({
      ...m,
      margin: m.revenue > 0 ? (m.pl / m.revenue) * 100 : 0,
    }))
    
    // Sort
    summaries.sort((a, b) => {
      const multiplier = sortAsc ? 1 : -1
      switch (sortField) {
        case 'monthKey': return multiplier * a.monthKey.localeCompare(b.monthKey)
        case 'orderCount': return multiplier * (a.orderCount - b.orderCount)
        case 'totalQty': return multiplier * (a.totalQty - b.totalQty)
        case 'revenue': return multiplier * (a.revenue - b.revenue)
        case 'costs': return multiplier * (a.costs - b.costs)
        case 'pl': return multiplier * (a.pl - b.pl)
        case 'margin': return multiplier * (a.margin - b.margin)
        default: return 0
      }
    })
    
    return summaries
  }, [data, sortField, sortAsc])

  // Chart data - always sorted by date ascending
  const chartData = useMemo(() => {
    if (!monthSummaries.length) return []
    return [...monthSummaries]
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-12)
      .map((m) => ({
        month: m.monthLabel.replace(/\s+\d{4}$/, ''), // Shorter label for chart
        revenue: m.revenue,
        pl: m.pl,
        costs: m.costs,
      }))
  }, [monthSummaries])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(field === 'monthKey')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">Loading sales data...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">{error || 'Failed to load'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sales by Date</h1>
        <p className="text-sm text-muted-foreground">{monthSummaries.length} months of shipped orders</p>
      </div>

      {/* Monthly P/L Bar Chart */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">Monthly Revenue & P/L (Last 12 Months)</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip 
                formatter={(value) => formatCurrency(value as number)}
                contentStyle={{ 
                  backgroundColor: 'var(--card)', 
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="revenue" fill="#38a169" name="Revenue" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pl" fill="#3182ce" name="P/L" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Monthly Table */}
      <div className="rounded-xl border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('monthKey')}>
                  <span className="flex items-center gap-1">Month <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('orderCount')}>
                  <span className="flex items-center justify-end gap-1">Orders <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('totalQty')}>
                  <span className="flex items-center justify-end gap-1">Total Qty <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('revenue')}>
                  <span className="flex items-center justify-end gap-1">Revenue <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('costs')}>
                  <span className="flex items-center justify-end gap-1">Costs <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('pl')}>
                  <span className="flex items-center justify-end gap-1">P/L <ArrowUpDown className="h-3 w-3" /></span>
                </th>
                <th className="px-4 py-3 text-right font-medium cursor-pointer hover:bg-muted" onClick={() => handleSort('margin')}>
                  <span className="flex items-center justify-end gap-1">Margin <ArrowUpDown className="h-3 w-3" /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {monthSummaries.map((month) => (
                <tr key={month.monthKey} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{month.monthLabel}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(month.orderCount)}</td>
                  <td className="px-4 py-3 text-right">{formatNumber(month.totalQty)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(month.revenue)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(month.costs)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${month.pl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {formatCurrency(month.pl)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${month.margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {month.margin.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
