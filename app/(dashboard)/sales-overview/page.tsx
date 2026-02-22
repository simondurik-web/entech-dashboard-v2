'use client'

import { useEffect, useState, useMemo } from 'react'
import { 
  PieChart, Pie, Cell, ResponsiveContainer, 
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  LineChart, Line, CartesianGrid
} from 'recharts'
import { useI18n } from '@/lib/i18n'
import { SpotlightCard } from '@/components/spotlight-card'
import { ScrollReveal } from '@/components/scroll-reveal'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { StaggeredGrid } from "@/components/ui/staggered-grid"

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
      <TableSkeleton rows={8} />
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
      <StaggeredGrid className="grid grid-cols-2 md:grid-cols-4 gap-4" stagger={100}>
        <SpotlightCard className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent" spotlightColor="34,197,94">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('stats.totalRevenue')}</p>
          <p className="text-2xl font-bold text-success mt-1"><AnimatedNumber value={formatCurrency(summary.totalRevenue)} /></p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(summary.orderCount)} orders</p>
        </SpotlightCard>
        <SpotlightCard className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent" spotlightColor="59,130,246">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">{t('salesOverview.totalPL')}</p>
          <p className={`text-2xl font-bold mt-1 ${summary.totalPL >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.totalPL)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Margin: {summary.avgMargin.toFixed(2)}%</p>
        </SpotlightCard>
        <SpotlightCard className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent" spotlightColor="16,185,129">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Shipped P/L</p>
          <p className={`text-2xl font-bold mt-1 ${(summary.shippedPL ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.shippedPL ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(summary.shippedCount ?? 0)} shipped</p>
        </SpotlightCard>
        <SpotlightCard className="relative rounded-xl border bg-card p-4 overflow-hidden stat-card-accent" spotlightColor="139,92,246">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Forecasted P/L</p>
          <p className={`text-2xl font-bold mt-1 ${(summary.forecastPL ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(summary.forecastPL ?? 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{formatNumber(summary.pendingCount ?? 0)} pending</p>
        </SpotlightCard>
      </StaggeredGrid>

      {/* Charts Row */}
      <ScrollReveal delay={100}>
      <div className="grid md:grid-cols-2 gap-6">
        {/* Revenue by Category Pie Chart */}
        <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-4 shadow-lg transition-all duration-200 hover:shadow-xl hover:border-white/[0.1]">
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
                  animationBegin={200}
                  animationDuration={800}
                  animationEasing="ease-out"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value as number)} contentStyle={{ backgroundColor: "hsl(var(--card) / 0.8)", backdropFilter: "blur(12px)", border: "1px solid hsl(var(--border))", borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }} />
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
        <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-4 shadow-lg transition-all duration-200 hover:shadow-xl hover:border-white/[0.1]">
          <h3 className="text-sm font-semibold mb-4">{t('salesOverview.topCustomers')}</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCustomers} layout="vertical" margin={{ left: 0 }}>
                <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => formatCurrency(value as number)} contentStyle={{ backgroundColor: "hsl(var(--card) / 0.8)", backdropFilter: "blur(12px)", border: "1px solid hsl(var(--border))", borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }} />
                <Bar dataKey="revenue" fill="#3182ce" radius={[0, 4, 4, 0]} animationBegin={300} animationDuration={800} animationEasing="ease-out" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      </ScrollReveal>

      {/* Monthly P/L Trend */}
      <ScrollReveal delay={200}>
      <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-4 shadow-lg transition-all duration-200 hover:shadow-xl hover:border-white/[0.1]">
        <h3 className="text-sm font-semibold mb-4">{t('salesOverview.monthlyPLTrend')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => formatCurrency(value as number)} contentStyle={{ backgroundColor: "hsl(var(--card) / 0.8)", backdropFilter: "blur(12px)", border: "1px solid hsl(var(--border))", borderRadius: "10px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#38a169" strokeWidth={2} name="Revenue" dot={{ r: 3 }} animationBegin={200} animationDuration={1000} animationEasing="ease-out" />
              <Line type="monotone" dataKey="pl" stroke="#3182ce" strokeWidth={2} name="P/L" dot={{ r: 3 }} animationBegin={400} animationDuration={1000} animationEasing="ease-out" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      </ScrollReveal>
    </div>
  )
}
