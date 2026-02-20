'use client'

import { useEffect, useState, useMemo } from 'react'
import { 
  PieChart, Pie, Cell, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  LineChart, Line, CartesianGrid
} from 'recharts'
import { useI18n } from '@/lib/i18n'

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

interface SalesSummary {
  totalRevenue: number
  totalCosts: number
  totalPL: number
  avgMargin: number
  orderCount: number
  shippedPL?: number
  shippedCount?: number
  forecastPL?: number
  pendingCount?: number
}

interface SalesData {
  orders: SalesOrder[]
  summary: SalesSummary
}

const CATEGORY_COLORS: Record<string, string> = {
  'Roll Tech': '#3182ce',
  'Molding': '#d69e2e',
  'Snap Pad': '#805ad5',
  'Other': '#718096',
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value))
}

export default function SalesOverviewPage() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()

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

  // Category breakdown for pie chart
  const categoryData = useMemo(() => {
    if (!data) return []
    const byCategory: Record<string, number> = {}
    for (const order of data.orders) {
      byCategory[order.category] = (byCategory[order.category] || 0) + order.revenue
    }
    return Object.entries(byCategory).map(([name, value]) => ({
      name,
      value,
      color: CATEGORY_COLORS[name] || '#718096',
    }))
  }, [data])

  // Top 10 customers
  const topCustomers = useMemo(() => {
    if (!data) return []
    const byCustomer: Record<string, number> = {}
    for (const order of data.orders) {
      byCustomer[order.customer] = (byCustomer[order.customer] || 0) + order.revenue
    }
    return Object.entries(byCustomer)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, revenue]) => ({ name: name.slice(0, 20), revenue }))
  }, [data])

  // Monthly P/L trend
  const monthlyTrend = useMemo(() => {
    if (!data) return []
    const byMonth: Record<string, { revenue: number; pl: number }> = {}
    for (const order of data.orders) {
      if (!order.shippedDate) continue
      const parts = order.shippedDate.split('/')
      if (parts.length < 3) continue
      const monthKey = `${parts[2]}-${parts[0].padStart(2, '0')}`
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { revenue: 0, pl: 0 }
      }
      byMonth[monthKey].revenue += order.revenue
      byMonth[monthKey].pl += order.pl
    }
    return Object.entries(byMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, values]) => {
        const [year, m] = month.split('-')
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        return {
          month: `${months[parseInt(m) - 1]} ${year.slice(-2)}`,
          ...values,
        }
      })
  }, [data])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">{t('ui.loading')}</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-destructive">{error || 'Failed to load sales data'}</p>
        </div>
      </div>
    )
  }

  const { summary } = data

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('page.salesOverview')}</h1>
        <p className="text-sm text-muted-foreground">{t('page.salesOverviewSubtitle')}</p>
      </div>

      {/* Summary Cards — matches HTML dashboard layout */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('stats.totalRevenue')}</p>
          <p className="text-2xl font-bold text-success mt-1">{formatCurrency(summary.totalRevenue)}</p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(summary.orderCount)} orders</p>
        </div>
        <div className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('salesOverview.totalPL')}</p>
          <p className={`text-2xl font-bold mt-1 ${summary.totalPL >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.totalPL)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Margin: {summary.avgMargin.toFixed(2)}%</p>
        </div>
        <div className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Shipped P/L</p>
          <p className={`text-2xl font-bold mt-1 ${(summary.shippedPL ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.shippedPL ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(summary.shippedCount ?? 0)} shipped</p>
        </div>
        <div className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Forecasted P/L</p>
          <p className={`text-2xl font-bold mt-1 ${(summary.forecastPL ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.forecastPL ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(summary.pendingCount ?? 0)} pending</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Revenue by Category Pie Chart */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">{t('salesOverview.revenueByCategory')}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value as number)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-4">
            {categoryData.map((cat) => (
              <div key={cat.name} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                <span>{cat.name}: {formatCurrency(cat.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Customers Bar Chart */}
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-4">{t('salesOverview.topCustomers')}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCustomers} layout="vertical" margin={{ left: 0 }}>
                <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => formatCurrency(value as number)} />
                <Bar dataKey="revenue" fill="#3182ce" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Monthly P/L Trend */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">{t('salesOverview.monthlyPLTrend')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => formatCurrency(value as number)} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#38a169" strokeWidth={2} name="Revenue" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pl" stroke="#3182ce" strokeWidth={2} name="P/L" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
