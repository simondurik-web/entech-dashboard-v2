'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { CategoryFilter, filterByCategory, DEFAULT_CATEGORIES } from '@/components/category-filter'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { getOrderCost } from '@/lib/sales-math'
import { Package, DollarSign, TrendingUp, BarChart2, ChevronDown, ChevronRight } from 'lucide-react'
import { Sparkline } from '@/components/ui/sparkline'
import { CategoryDonutChart } from '@/components/sales/CategoryDonutChart'
import { EnhancedStatCard } from '@/components/sales/EnhancedStatCard'

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
  variableProfit: number
  totalProfit: number
  variableMarginPct: number
  totalMarginPct: number
  shippedDate: string
  status: string
  contributionLevel: string
}

interface SalesData {
  orders: SalesOrder[]
  summary: { totalRevenue: number; totalCosts: number; totalPL: number; avgMargin: number; orderCount: number }
}

interface PartRow extends Record<string, unknown> {
  partNumber: string
  category: string
  orderCount: number
  totalQty: number
  avgPricePerPart: number
  revenue: number
  costs: number
  totalProfit: number
  totalMarginPct: number
  orders: SalesOrder[]
}

interface CustomerGroupRow extends Record<string, unknown> {
  customer: string
  orderCount: number
  totalQty: number
  avgPricePerPart: number
  revenue: number
  costs: number
  totalProfit: number
  totalMarginPct: number
  orders: SalesOrder[]
}

interface OrderRow extends Record<string, unknown> {
  line: string
  customer: string
  qty: number
  pricePerPart: number
  revenue: number
  totalCost: number
  totalProfit: number
  shippedDate: string
  status: string
}

function fmt(v: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v) }
function fmtN(v: number) { return new Intl.NumberFormat('en-US').format(Math.round(v)) }

const CAT_CLS: Record<string, string> = {
  'Roll Tech': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  Molding: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  'Snap Pad': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  Other: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
}

// ─── Sparkline helper ─────────────────────────────────────────────────────────

function getLast6MonthsRevenue(orders: { shippedDate?: string; revenue: number }[]): number[] {
  const byMonth: Record<string, number> = {}
  for (const o of orders) {
    if (!o.shippedDate) continue
    const d = new Date(o.shippedDate)
    if (isNaN(d.getTime())) continue
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byMonth[mk] = (byMonth[mk] || 0) + o.revenue
  }
  const sorted = Object.keys(byMonth).sort().slice(-6)
  return sorted.map((k) => byMonth[k])
}

const ORDER_COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'line', label: 'Line', sortable: true, filterable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'qty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'pricePerPart', label: 'Price/Part', sortable: true, render: (v) => fmt(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'totalCost', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'totalProfit', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{fmt(v as number)}</span> },
  { key: 'shippedDate', label: 'Shipped', sortable: true, filterable: true },
  { key: 'status', label: 'Status', sortable: true, filterable: true },
]

const CUSTOMER_GROUP_COLUMNS: ColumnDef<CustomerGroupRow>[] = [
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'avgPricePerPart', label: 'Avg Price/Part', sortable: true, render: (v) => fmt(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'costs', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'totalProfit', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
  { key: 'totalMarginPct', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{(v as number).toFixed(1)}%</span> },
]

function OrdersDataTable({ orders, storageKey }: { orders: SalesOrder[]; storageKey: string }) {
  const rows: OrderRow[] = useMemo(() => orders.map((o) => ({
    line: o.line,
    customer: o.customer,
    qty: o.qty,
    pricePerPart: o.qty > 0 ? o.revenue / o.qty : 0,
    revenue: o.revenue,
    totalCost: o.totalCost || 0,
    totalProfit: o.totalProfit,
    shippedDate: o.shippedDate,
    status: o.status,
  })), [orders])

  const table = useDataTable({ data: rows, columns: ORDER_COLUMNS, storageKey })

  return <DataTable table={table} data={rows} noun="order" exportFilename={storageKey} page={storageKey} getRowKey={(r) => (r as OrderRow).line} />
}

function CustomersDataTable({ customerGroups, partNumber }: { customerGroups: [string, SalesOrder[]][]; partNumber: string }) {
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)

  const rows: CustomerGroupRow[] = useMemo(() => customerGroups.map(([customer, orders]) => {
    const totalQty = orders.reduce((s, o) => s + o.qty, 0)
    const revenue = orders.reduce((s, o) => s + o.revenue, 0)
    const costs = orders.reduce((s, o) => s + getOrderCost(o), 0)
    const totalProfit = orders.reduce((s, o) => s + o.totalProfit, 0)
    const avgPricePerPart = totalQty > 0 ? revenue / totalQty : 0
    return { customer, orderCount: orders.length, totalQty, avgPricePerPart, revenue, costs, totalProfit, totalMarginPct: revenue > 0 ? (totalProfit / revenue) * 100 : 0, orders }
  }), [customerGroups])

  const table = useDataTable({ data: rows, columns: CUSTOMER_GROUP_COLUMNS, storageKey: `${partNumber}_customers` })

  return (
    <DataTable
      table={table}
      data={rows}
      noun="customer"
      exportFilename={`${partNumber}_customers`}
      page={`${partNumber}_customers`}
      getRowKey={(r) => (r as CustomerGroupRow).customer}
      expandedRowKey={expandedCustomer}
      onRowClick={(r) => {
        const key = (r as CustomerGroupRow).customer
        setExpandedCustomer((prev) => (prev === key ? null : key))
      }}
      renderExpandedContent={(r) => {
        const row = r as CustomerGroupRow
        return <OrdersDataTable orders={row.orders} storageKey={`${partNumber}_${row.customer.replace(/\W/g, '_')}_orders`} />
      }}
    />
  )
}

function PartExpandedSection({ part }: { part: PartRow }) {
  const customerGroups = useMemo(() => {
    const grp: Record<string, SalesOrder[]> = {}
    for (const o of part.orders) {
      const k = o.customer || 'Unknown'
      ;(grp[k] ??= []).push(o)
    }
    return Object.entries(grp).sort((a, b) => b[1].reduce((s, o) => s + o.revenue, 0) - a[1].reduce((s, o) => s + o.revenue, 0))
  }, [part.orders])

  if (customerGroups.length <= 1) {
    return <OrdersDataTable orders={part.orders} storageKey={`${part.partNumber}_orders`} />
  }

  return <CustomersDataTable customerGroups={customerGroups} partNumber={part.partNumber} />
}

export default function SalesPartsPage() {
  return <Suspense><SalesPartsContent /></Suspense>
}

function SalesPartsContent() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedPart, setExpandedPart] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState(DEFAULT_CATEGORIES)
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()

  useEffect(() => {
    fetch('/api/sales')
      .then((r) => (r.ok ? r.json() : Promise.reject('Failed')))
      .then((d) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const filteredOrders = useMemo(() => {
    if (!data) return []
    return filterByCategory(data.orders, categoryFilter)
  }, [data, categoryFilter])

  const partSummaries: PartRow[] = useMemo(() => {
    if (!filteredOrders.length && !data) return []
    const byPart: Record<string, PartRow> = {}
    for (const o of filteredOrders) {
      const k = o.partNumber || 'Unknown'
      if (!byPart[k]) byPart[k] = { partNumber: k, category: o.category, orderCount: 0, totalQty: 0, avgPricePerPart: 0, revenue: 0, costs: 0, totalProfit: 0, totalMarginPct: 0, orders: [] }
      byPart[k].orderCount++
      byPart[k].totalQty += o.qty
      byPart[k].revenue += o.revenue
      byPart[k].costs += getOrderCost(o)
      byPart[k].totalProfit += o.totalProfit
      byPart[k].orders.push(o)
    }
    return Object.values(byPart).map((p) => ({ ...p, avgPricePerPart: p.totalQty > 0 ? p.revenue / p.totalQty : 0, totalMarginPct: p.revenue > 0 ? (p.totalProfit / p.revenue) * 100 : 0 }))
  }, [filteredOrders, data])

  // ─── Top-level aggregates for EnhancedStatCards ───
  const totals = useMemo(() => {
    const totalRevenue = partSummaries.reduce((s, p) => s + p.revenue, 0)
    const totalProfit = partSummaries.reduce((s, p) => s + p.totalProfit, 0)
    const totalMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    return { totalRevenue, totalProfit, totalMarginPct, partCount: partSummaries.length }
  }, [partSummaries])

  const PART_COLUMNS: ColumnDef<PartRow>[] = useMemo(() => [
    {
      key: 'partNumber',
      label: t('table.partNumber'),
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const r = row as PartRow
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
      label: t('table.category'),
      sortable: true,
      filterable: true,
      render: (v) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CAT_CLS[v as string] || CAT_CLS.Other}`}>{v as string}</span>,
    },
    { key: 'orderCount', label: t('table.orders'), sortable: true, render: (v) => fmtN(v as number) },
    { key: 'totalQty', label: t('table.qty'), sortable: true, render: (v) => fmtN(v as number) },
    { key: 'avgPricePerPart', label: 'Avg Price/Part', sortable: true, render: (v) => fmt(v as number) },
    { key: 'revenue', label: t('table.revenue'), sortable: true, render: (v) => fmt(v as number) },
    { key: 'costs', label: t('salesOverview.totalCosts'), sortable: true, render: (v) => fmt(v as number) },
    { key: 'totalProfit', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'totalMarginPct', label: t('salesOverview.avgMargin'), sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{(v as number).toFixed(1)}%</span> },
    {
      key: 'trend',
      label: 'Trend',
      render: (_v, row) => {
        const r = row as PartRow
        const sparkData = getLast6MonthsRevenue(r.orders)
        if (sparkData.length < 2) return <span className="text-muted-foreground text-xs">—</span>
        return <Sparkline data={sparkData} />
      },
    },
  ], [t, expandedPart])

  const table = useDataTable({ data: partSummaries, columns: PART_COLUMNS, storageKey: 'sales-by-part' })

  if (loading) return <TableSkeleton rows={8} />
  if (error || !data) return <div className="p-6"><div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"><p className="text-destructive">{error || 'Failed'}</p></div></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('page.salesByPart')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.salesByPartSubtitle')}</p>
        </div>
        <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
      </div>

      {/* Top-level Stat Cards (Enhancement 3 + 7) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <EnhancedStatCard
          icon={<Package className="size-4" />}
          label="Parts"
          value={String(totals.partCount)}
          color="bg-blue-500/10 text-blue-400"
        />
        <EnhancedStatCard
          icon={<BarChart2 className="size-4" />}
          label="Total Orders"
          value={fmtN(partSummaries.reduce((s, p) => s + p.orderCount, 0))}
          color="bg-violet-500/10 text-violet-400"
        />
        <EnhancedStatCard
          icon={<DollarSign className="size-4" />}
          label="Revenue"
          value={fmt(totals.totalRevenue)}
          color="bg-emerald-500/10 text-emerald-400"
        />
        <EnhancedStatCard
          icon={<TrendingUp className="size-4" />}
          label="P/L"
          value={fmt(totals.totalProfit)}
          sub={`${totals.totalMarginPct.toFixed(1)}% margin`}
          color={totals.totalProfit >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}
        />
      </div>

      {/* Category Donut Chart (Enhancement 4) */}
      <CategoryDonutChart orders={filteredOrders} />

      {/* Parts Table */}
      <DataTable
        table={table}
        data={partSummaries}
        noun="part"
        exportFilename="sales-by-part"
        page="sales-by-part"
        initialView={initialView}
        autoExport={autoExport}
        getRowKey={(row) => (row as PartRow).partNumber}
        expandedRowKey={expandedPart}
        onRowClick={(row) => {
          const pn = (row as PartRow).partNumber
          setExpandedPart((prev) => (prev === pn ? null : pn))
        }}
        renderExpandedContent={(row) => <PartExpandedSection part={row as PartRow} />}
      />
    </div>
  )
}
