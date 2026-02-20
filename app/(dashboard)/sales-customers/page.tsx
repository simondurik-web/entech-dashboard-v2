'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { Package, Hash, DollarSign, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts'

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface CustomerRow extends Record<string, unknown> {
  customer: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
  orders: SalesOrder[]
}

interface PartSummaryRow extends Record<string, unknown> {
  partNumber: string
  category: string
  orderCount: number
  totalQty: number
  avgUnitPrice: number
  revenue: number
  totalCost: number
  pl: number
  margin: number
  contribution: string
  orders: SalesOrder[]
}

interface OrderRow extends Record<string, unknown> {
  line: string
  partNumber: string
  category: string
  qty: number
  unitPrice: number
  revenue: number
  totalCost: number
  pl: number
  margin: number
  shippedDate: string
  status: string
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmt(v: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v) }
function fmtN(v: number) { return new Intl.NumberFormat('en-US').format(Math.round(v)) }
function fmtPrice(v: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) }

const CATEGORY_CLASSES: Record<string, string> = {
  'Roll Tech': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  Molding: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  'Snap Pad': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  Other: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
}

// ─── Customer-level columns ──────────────────────────────────────────────────

const CUSTOMER_COLUMNS: ColumnDef<CustomerRow>[] = [
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'costs', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
  { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{(v as number).toFixed(1)}%</span> },
]

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 flex items-start gap-3 shadow-sm">
      <div className={`rounded-lg p-2.5 ${color || 'bg-primary/10 text-primary'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Price History Chart ─────────────────────────────────────────────────────

function PriceHistoryChart({ orders }: { orders: SalesOrder[] }) {
  const chartData = useMemo(() => {
    const sorted = [...orders]
      .filter((o) => o.shippedDate && o.qty > 0)
      .sort((a, b) => new Date(a.shippedDate).getTime() - new Date(b.shippedDate).getTime())
      .map((o) => ({
        date: new Date(o.shippedDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        rawDate: o.shippedDate,
        unitPrice: o.revenue / o.qty,
        qty: o.qty,
        line: o.line,
      }))
    return sorted
  }, [orders])

  const avgPrice = useMemo(() => {
    if (chartData.length === 0) return 0
    return chartData.reduce((s, d) => s + d.unitPrice, 0) / chartData.length
  }, [chartData])

  if (chartData.length < 2) return null

  // Determine price trend
  const firstPrice = chartData[0].unitPrice
  const lastPrice = chartData[chartData.length - 1].unitPrice
  const priceChange = lastPrice - firstPrice
  const pctChange = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0
  const isUp = priceChange >= 0

  // Colors
  const lineColor = isUp ? '#10b981' : '#ef4444' // emerald-500 / red-500
  const gradientId = `priceGradient_${orders[0]?.partNumber?.replace(/\W/g, '_') || 'default'}`

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Price History</h4>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {fmtPrice(firstPrice)} → {fmtPrice(lastPrice)}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
            {isUp ? '↑' : '↓'} {Math.abs(pctChange).toFixed(1)}%
          </span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
              <stop offset="50%" stopColor={lineColor} stopOpacity={0.1} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            dy={8}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v.toFixed(0)}`}
            width={55}
            domain={['auto', 'auto']}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '10px',
              fontSize: '13px',
              padding: '10px 14px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            }}
            formatter={(value: number | undefined) => [fmtPrice(value ?? 0), 'Unit Price']}
            labelFormatter={(label) => label}
            cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.5 }}
          />
          <ReferenceLine
            y={avgPrice}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="6 4"
            opacity={0.4}
            label={{ value: `Avg ${fmtPrice(avgPrice)}`, position: 'insideTopRight', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
          />
          <Area
            type="monotone"
            dataKey="unitPrice"
            stroke={lineColor}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={{ r: 4, fill: lineColor, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
            activeDot={{ r: 7, strokeWidth: 3, stroke: lineColor, fill: 'hsl(var(--card))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Contribution Badge ──────────────────────────────────────────────────────

function ContributionBadge({ margin }: { margin: number }) {
  if (margin >= 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        PROFITABLE
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
      LOSS
    </span>
  )
}

// ─── Part Expanded Row (orders + chart) ──────────────────────────────────────

function PartExpandedContent({ part }: { part: PartSummaryRow }) {
  const orderRows: OrderRow[] = useMemo(() =>
    part.orders
      .sort((a, b) => new Date(b.shippedDate).getTime() - new Date(a.shippedDate).getTime())
      .map((o) => ({
        line: o.line,
        partNumber: o.partNumber,
        category: o.category,
        qty: o.qty,
        unitPrice: o.qty > 0 ? o.revenue / o.qty : 0,
        revenue: o.revenue,
        totalCost: o.totalCost || o.variableCost,
        pl: o.pl,
        margin: o.revenue > 0 ? (o.pl / o.revenue) * 100 : 0,
        shippedDate: o.shippedDate,
        status: o.status,
      })),
    [part.orders]
  )

  const ORDER_DETAIL_COLUMNS: ColumnDef<OrderRow>[] = useMemo(() => [
    { key: 'line', label: 'Line', sortable: true, filterable: true },
    { key: 'status', label: 'Status', sortable: true, filterable: true, render: (v) => {
      const s = v as string
      const cls = s === 'shipped' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
      return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{s}</span>
    }},
    { key: 'qty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'unitPrice', label: 'Unit Price', sortable: true, render: (v) => fmtPrice(v as number) },
    { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
    { key: 'totalCost', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'margin', label: 'Margin', sortable: true, render: (v) => {
      const n = v as number
      return <span className={n >= 0 ? 'text-emerald-400' : 'text-red-400'}>{n.toFixed(1)}%</span>
    }},
    { key: 'shippedDate', label: 'Shipped', sortable: true, filterable: true },
  ], [])

  const storageKey = `customer_part_${part.partNumber.replace(/\W/g, '_')}_orders`
  const table = useDataTable({ data: orderRows, columns: ORDER_DETAIL_COLUMNS, storageKey })

  return (
    <div className="space-y-4 py-2">
      <PriceHistoryChart orders={part.orders} />
      <DataTable table={table} data={orderRows} noun="order" exportFilename={storageKey} page={storageKey} />
    </div>
  )
}

// ─── Customer Drilldown (stat cards + part summary table) ────────────────────

function CustomerDrilldown({ customerRow }: { customerRow: CustomerRow }) {
  const [expandedPart, setExpandedPart] = useState<string | null>(null)

  // Group orders by part number
  const partSummaries: PartSummaryRow[] = useMemo(() => {
    const byPart: Record<string, { orders: SalesOrder[]; category: string }> = {}
    for (const o of customerRow.orders) {
      const k = o.partNumber || 'Unknown'
      if (!byPart[k]) byPart[k] = { orders: [], category: o.category }
      byPart[k].orders.push(o)
    }

    return Object.entries(byPart)
      .map(([partNumber, { orders, category }]) => {
        const totalQty = orders.reduce((s, o) => s + o.qty, 0)
        const revenue = orders.reduce((s, o) => s + o.revenue, 0)
        const totalCost = orders.reduce((s, o) => s + (o.totalCost || o.variableCost), 0)
        const pl = orders.reduce((s, o) => s + o.pl, 0)
        const margin = revenue > 0 ? (pl / revenue) * 100 : 0
        const avgUnitPrice = totalQty > 0 ? revenue / totalQty : 0
        return {
          partNumber,
          category,
          orderCount: orders.length,
          totalQty,
          avgUnitPrice,
          revenue,
          totalCost,
          pl,
          margin,
          contribution: margin >= 0 ? 'PROFITABLE' : 'LOSS',
          orders,
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [customerRow.orders])

  const uniquePartCount = partSummaries.length

  const PART_SUMMARY_COLUMNS: ColumnDef<PartSummaryRow>[] = useMemo(() => [
    {
      key: 'partNumber',
      label: 'Part Number',
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const r = row as PartSummaryRow
        const isExpanded = expandedPart === r.partNumber
        return (
          <span className="flex items-center gap-1.5 font-medium">
            {isExpanded ? <ChevronDown className="size-3.5 text-primary" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
            {v as string}
          </span>
        )
      },
    },
    {
      key: 'category',
      label: 'Category',
      sortable: true,
      filterable: true,
      render: (v) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CATEGORY_CLASSES[v as string] || CATEGORY_CLASSES.Other}`}>{v as string}</span>,
    },
    { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'avgUnitPrice', label: 'Avg Unit Price', sortable: true, render: (v) => fmtPrice(v as number) },
    { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
    {
      key: 'contribution',
      label: 'Contribution',
      sortable: true,
      filterable: true,
      render: (_v, row) => <ContributionBadge margin={(row as PartSummaryRow).margin} />,
    },
    {
      key: 'margin',
      label: 'Margin',
      sortable: true,
      render: (v) => {
        const n = v as number
        return <span className={n >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{n.toFixed(1)}%</span>
      },
    },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{fmt(v as number)}</span> },
  ], [expandedPart])

  const storageKey = `sales_customer_${customerRow.customer.replace(/\W/g, '_')}_parts`
  const table = useDataTable({ data: partSummaries, columns: PART_SUMMARY_COLUMNS, storageKey })

  return (
    <div className="space-y-4 py-3">
      {/* Breadcrumb */}
      <p className="text-xs text-muted-foreground">
        Customers › <span className="text-foreground font-medium">{customerRow.customer}</span>
      </p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          icon={<Package className="size-4" />}
          label="Products"
          value={String(uniquePartCount)}
          color="bg-blue-500/10 text-blue-400"
        />
        <StatCard
          icon={<Hash className="size-4" />}
          label="Total Qty"
          value={fmtN(customerRow.totalQty)}
          sub={`${fmtN(customerRow.orderCount)} orders`}
          color="bg-violet-500/10 text-violet-400"
        />
        <StatCard
          icon={<DollarSign className="size-4" />}
          label="Revenue"
          value={fmt(customerRow.revenue)}
          color="bg-emerald-500/10 text-emerald-400"
        />
        <StatCard
          icon={<TrendingUp className="size-4" />}
          label="P/L"
          value={fmt(customerRow.pl)}
          sub={`${customerRow.margin.toFixed(1)}% margin`}
          color={customerRow.pl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
        />
      </div>

      {/* Part Summary Table */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Product Breakdown</h3>
        <DataTable
          table={table}
          data={partSummaries}
          noun="part"
          exportFilename={storageKey}
          page={storageKey}
          getRowKey={(row) => (row as PartSummaryRow).partNumber}
          expandedRowKey={expandedPart}
          onRowClick={(row) => {
            const pn = (row as PartSummaryRow).partNumber
            setExpandedPart((prev) => (prev === pn ? null : pn))
          }}
          renderExpandedContent={(row) => <PartExpandedContent part={row as PartSummaryRow} />}
        />
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SalesCustomersPage() {
  return <Suspense><SalesCustomersContent /></Suspense>
}

function SalesCustomersContent() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)
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

  const customerRows: CustomerRow[] = useMemo(() => {
    if (!data) return []
    const byCustomer: Record<string, CustomerRow> = {}
    for (const order of data.orders) {
      const key = order.customer || 'Unknown'
      if (!byCustomer[key]) {
        byCustomer[key] = { customer: key, orderCount: 0, totalQty: 0, revenue: 0, costs: 0, pl: 0, margin: 0, orders: [] }
      }
      byCustomer[key].orderCount++
      byCustomer[key].totalQty += order.qty
      byCustomer[key].revenue += order.revenue
      byCustomer[key].costs += order.totalCost || order.variableCost
      byCustomer[key].pl += order.pl
      byCustomer[key].orders.push(order)
    }
    return Object.values(byCustomer).map((c) => ({ ...c, margin: c.revenue > 0 ? (c.pl / c.revenue) * 100 : 0 }))
  }, [data])

  const table = useDataTable({ data: customerRows, columns: CUSTOMER_COLUMNS, storageKey: 'sales-by-customer' })

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" /></div>
  if (error || !data) return <div className="p-6"><div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"><p className="text-destructive">{error || 'Failed to load'}</p></div></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('page.salesByCustomer')}</h1>
        <p className="text-sm text-muted-foreground">{t('page.salesByCustomerSubtitle')}</p>
      </div>

      <DataTable
        table={table}
        data={customerRows}
        noun="customer"
        exportFilename="sales-by-customer"
        page="sales-by-customer"
        initialView={initialView}
        autoExport={autoExport}
        getRowKey={(row) => (row as CustomerRow).customer}
        expandedRowKey={expandedCustomer}
        onRowClick={(row) => {
          const c = (row as CustomerRow).customer
          setExpandedCustomer((prev) => (prev === c ? null : c))
        }}
        renderExpandedContent={(row) => <CustomerDrilldown customerRow={row as CustomerRow} />}
      />
    </div>
  )
}
