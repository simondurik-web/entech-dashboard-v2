'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { useI18n } from '@/lib/i18n'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'

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

interface MonthRow extends Record<string, unknown> {
  monthKey: string
  monthLabel: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
}

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
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
  return `${year}-${parts[0].padStart(2, '0')}`
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month, 10) - 1]} ${year}`
}

const MONTH_COLUMNS: ColumnDef<MonthRow>[] = [
  { key: 'monthLabel', label: 'Month', sortable: true, filterable: true },
  { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => formatNumber(v as number) },
  { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => formatNumber(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => formatCurrency(v as number) },
  { key: 'costs', label: 'Total Costs', sortable: true, render: (v) => formatCurrency(v as number) },
  { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{formatCurrency(v as number)}</span> },
  { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{(v as number).toFixed(1)}%</span> },
]

export default function SalesDatesPage() {
  return <Suspense><SalesDatesContent /></Suspense>
}

function SalesDatesContent() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()

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

  const monthRows = useMemo(() => {
    if (!data) return [] as MonthRow[]
    const byMonth: Record<string, MonthRow> = {}

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

    return Object.values(byMonth).map((m) => ({ ...m, margin: m.revenue > 0 ? (m.pl / m.revenue) * 100 : 0 }))
  }, [data])

  const chartData = useMemo(() => {
    if (!monthRows.length) return []
    return [...monthRows]
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-12)
      .map((m) => ({ month: m.monthLabel.replace(/\s+\d{4}$/, ''), revenue: m.revenue, pl: m.pl, costs: m.costs }))
  }, [monthRows])

  const table = useDataTable({ data: monthRows, columns: MONTH_COLUMNS, storageKey: 'sales-by-date' })

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" /></div>
  if (error || !data) return <div className="p-6"><div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"><p className="text-destructive">{error || 'Failed to load'}</p></div></div>

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('page.salesByDate')}</h1>
        <p className="text-sm text-muted-foreground">{t('page.salesByDateSubtitle')}</p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">{t('salesDates.monthlyRevenuePL')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => formatCurrency(value as number)} contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px' }} />
              <Legend />
              <Bar dataKey="revenue" fill="#38a169" name={t('table.revenue')} radius={[4, 4, 0, 0]} />
              <Bar dataKey="pl" fill="#3182ce" name="P/L" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <DataTable table={table} data={monthRows} noun="month" exportFilename="sales-by-date" page="sales-by-date" initialView={initialView} autoExport={autoExport} />
    </div>
  )
}
