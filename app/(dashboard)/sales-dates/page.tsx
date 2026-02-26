'use client'

import { Suspense, useEffect, useMemo, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Line, ComposedChart, AreaChart, Area,
} from 'recharts'
import { useI18n } from '@/lib/i18n'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'
import { CalendarDays, Package, DollarSign, TrendingUp, Percent, ChevronDown, ChevronRight, X, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { exportSalesDateExcel } from '@/lib/export-sales-dates'
import { Button } from '@/components/ui/button'
import { CategoryFilter, filterByCategory, DEFAULT_CATEGORIES } from '@/components/category-filter'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { AnimatedNumber } from "@/components/ui/animated-number"
import { ScrollReveal } from "@/components/scroll-reveal"
import { StaggeredGrid } from "@/components/ui/staggered-grid"

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
  requestedDate: string
  status: string
  dateOfRequest: string
  ifNumber: string
  ifStatus: string
  internalStatus: string
  poNumber: string
  shippingCost: number
  unitPrice: number
  salesTarget: number
  profitPerPart: number
}

interface SalesData {
  orders: SalesOrder[]
  summary: {
    totalRevenue: number; totalCosts: number; totalPL: number; avgMargin: number
    orderCount: number; shippedPL?: number; shippedCount?: number; forecastPL?: number; pendingCount?: number
  }
}

interface MonthRow extends Record<string, unknown> {
  monthKey: string
  monthLabel: string
  statusText: string
  orderCount: number
  shippedCount: number
  totalQty: number
  revenue: number
  costs: number
  shippedPL: number
  forecastPL: number
  shippedRevenue: number
  forecastRevenue: number
  pl: number
  margin: number
  orders: SalesOrder[]
  revMoM: number | null
  revYoY: number | null
  plMoM: number | null
  plYoY: number | null
  marginMoM: number | null
  marginYoY: number | null
}

interface MonthlyOrderRow extends Record<string, unknown> {
  category: string
  dateOfRequest: string
  ifNumber: string
  ifStatus: string
  internalStatus: string
  poNumber: string
  customer: string
  partNumber: string
  qty: number
  requestedDate: string
  unitPrice: number
  contribution: number
  variableCost: number
  totalCost: number
  salesTarget: number
  profitPerPart: number
  pl: number
  revenue: number
  shippedDate: string
  shippingCost: number
  line: string
  status: string
}

interface CustomerBreakdownRow extends Record<string, unknown> {
  customer: string
  orderCount: number
  totalQty: number
  revenue: number
  pl: number
  margin: number
  revMoM: number | null
  revYoY: number | null
  plMoM: number | null
}

interface CustomerOrderRow extends Record<string, unknown> {
  partNumber: string
  qty: number
  unitPrice: number
  revenue: number
  pl: number
  margin: number
  status: string
  shippedDate: string
}

interface CustomerMonthlyPoint {
  month: string
  revenue: number
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

// ─── Attribution date logic (matches V1 HTML) ────────────────────────────────
// Shipped → use shippedDate. Not shipped → use requestedDate (forecast).

function getAttributionDate(order: SalesOrder): string | null {
  if (order.status === 'shipped') return order.shippedDate || null
  return order.requestedDate || null
}

function getMonthKey(dateStr: string): string | null {
  if (!dateStr) return null
  // Handle "M/D/YYYY" format
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/')
    if (parts.length < 3) return null
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
    return `${year}-${parts[0].padStart(2, '0')}`
  }
  // Handle ISO "YYYY-MM-DD"
  return dateStr.substring(0, 7)
}

function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month, 10) - 1]} ${year}`
}

// ─── Month key arithmetic ────────────────────────────────────────────────────

function getPrevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  if (m === 1) return `${y - 1}-12`
  return `${y}-${String(m - 1).padStart(2, '0')}`
}

function getPrevYearMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  return `${Number(y) - 1}-${m}`
}

// ─── Change indicator renderer ───────────────────────────────────────────────

function ChangeIndicator({ value, format }: { value: number | null; format: 'pct' | 'dollar' | 'pp' }) {
  if (value === null) return <span className="text-muted-foreground">-</span>
  if (value === 0) return <span className="text-muted-foreground">0{format === 'pct' ? '%' : format === 'pp' ? 'pp' : ''}</span>
  const positive = value > 0
  const cls = positive ? 'text-emerald-400' : 'text-red-400'
  const arrow = positive ? '↑' : '↓'
  let formatted: string
  if (format === 'pct') {
    formatted = `${positive ? '+' : ''}${value.toFixed(1)}%`
  } else if (format === 'pp') {
    formatted = `${positive ? '+' : ''}${value.toFixed(1)}pp`
  } else {
    formatted = fmt(value)
  }
  return <span className={`${cls} font-medium whitespace-nowrap`}>{arrow} {formatted}</span>
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-4 flex items-start gap-3 shadow-lg transition-all duration-200 ease-out hover:shadow-xl hover:border-white/[0.1] hover:bg-white/[0.04]">
      <div className={`rounded-lg p-2.5 ${color || 'bg-primary/10 text-primary'}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold mt-0.5"><AnimatedNumber value={value} duration={2500} /></p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Contribution Badge ──────────────────────────────────────────────────────

function ContributionBadge({ margin }: { margin: number }) {
  if (margin >= 20) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">HIGH</span>
  if (margin >= 10) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">MEDIUM</span>
  if (margin >= 0) return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">LOW</span>
  return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">NEGATIVE</span>
}

// ─── Monthly Orders Table (Drilldown Level 1a) ──────────────────────────────

function MonthlyOrdersTable({ orders, monthLabel }: { orders: SalesOrder[]; monthLabel: string }) {
  const rows: MonthlyOrderRow[] = useMemo(() =>
    orders.map((o) => {
      const unitPrice = o.unitPrice || (o.qty > 0 ? o.revenue / o.qty : 0)
      const profitPerPart = o.profitPerPart || (o.qty > 0 ? o.pl / o.qty : 0)
      const margin = o.revenue > 0 ? (o.pl / o.revenue) * 100 : 0
      const salesTarget = o.salesTarget || unitPrice * 1.2
      return {
        category: o.category,
        dateOfRequest: o.dateOfRequest || '-',
        ifNumber: o.ifNumber || '-',
        ifStatus: o.ifStatus || '-',
        internalStatus: o.internalStatus || '-',
        poNumber: o.poNumber || '-',
        customer: o.customer,
        partNumber: o.partNumber,
        qty: o.qty,
        requestedDate: o.requestedDate || '-',
        unitPrice,
        contribution: margin,
        variableCost: o.variableCost,
        totalCost: o.totalCost || o.variableCost,
        salesTarget,
        profitPerPart,
        pl: o.pl,
        revenue: o.revenue,
        shippedDate: o.shippedDate || '-',
        shippingCost: o.shippingCost || 0,
        line: o.line,
        status: o.status,
      }
    }),
    [orders]
  )

  const ORDER_COLUMNS: ColumnDef<MonthlyOrderRow>[] = useMemo(() => [
    { key: 'category', label: 'Category', sortable: true, filterable: true, render: (v) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CATEGORY_CLASSES[v as string] || CATEGORY_CLASSES.Other}`}>{v as string}</span> },
    { key: 'dateOfRequest', label: 'Date of Request', sortable: true, filterable: true },
    { key: 'ifNumber', label: 'IF #', sortable: true, filterable: true },
    { key: 'ifStatus', label: 'IF Status in Fusion', sortable: true, filterable: true },
    { key: 'internalStatus', label: 'Internal Status', sortable: true, filterable: true, render: (v) => {
      const s = (v as string).toLowerCase()
      const cls = s.includes('ship') ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : s.includes('staged') ? 'bg-blue-500/15 text-blue-400 border-blue-500/30' : s.includes('progress') || s.includes('wip') ? 'bg-orange-500/15 text-orange-400 border-orange-500/30' : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
      return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{v as string}</span>
    }},
    { key: 'poNumber', label: 'PO #', sortable: true, filterable: true },
    { key: 'customer', label: 'Customer', sortable: true, filterable: true },
    { key: 'partNumber', label: 'Part #', sortable: true, filterable: true },
    { key: 'qty', label: 'Order Qty', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'requestedDate', label: 'Requested Date', sortable: true, filterable: true },
    { key: 'unitPrice', label: 'Unit Price', sortable: true, render: (v) => fmtPrice(v as number) },
    { key: 'contribution', label: 'Contribution Level', sortable: true, filterable: true, render: (v) => <ContributionBadge margin={v as number} /> },
    { key: 'variableCost', label: 'Variable Cost', sortable: true, render: (v) => fmt(v as number) },
    { key: 'totalCost', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
    { key: 'salesTarget', label: 'Sales Target (20%)', sortable: true, render: (v) => fmt(v as number) },
    { key: 'profitPerPart', label: 'Profit/Part', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtPrice(v as number)}</span> },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
    { key: 'shippedDate', label: 'Shipped Date', sortable: true, filterable: true },
    { key: 'shippingCost', label: 'Shipping Cost', sortable: true, render: (v) => fmt(v as number) },
  ], [])

  const storageKey = `sales_date_monthly_${monthLabel.replace(/\W/g, '_')}`
  const table = useDataTable({ data: rows, columns: ORDER_COLUMNS, storageKey })

  return <DataTable table={table} data={rows} noun="order" exportFilename={storageKey} page={storageKey} onExcelExport={exportSalesDateExcel} />
}

// ─── Customer Order Sub-Table (Drilldown Level 2) ───────────────────────────

function CustomerOrderSubTable({ orders, customer }: { orders: SalesOrder[]; customer: string }) {
  const rows: CustomerOrderRow[] = useMemo(() =>
    orders.filter(o => (o.customer || 'Unknown') === customer).map(o => ({
      partNumber: o.partNumber,
      qty: o.qty,
      unitPrice: o.unitPrice || (o.qty > 0 ? o.revenue / o.qty : 0),
      revenue: o.revenue,
      pl: o.pl,
      margin: o.revenue > 0 ? (o.pl / o.revenue) * 100 : 0,
      status: o.status,
      shippedDate: o.shippedDate || '-',
    })),
    [orders, customer]
  )

  const COLS: ColumnDef<CustomerOrderRow>[] = useMemo(() => [
    { key: 'partNumber', label: 'Part #', sortable: true, filterable: true },
    { key: 'qty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'unitPrice', label: 'Unit Price', sortable: true, render: (v) => fmtPrice(v as number) },
    { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{(v as number).toFixed(1)}%</span> },
    { key: 'status', label: 'Status', sortable: true, filterable: true, render: (v) => {
      const s = (v as string).toLowerCase()
      const cls = s === 'shipped' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
      return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{v as string}</span>
    }},
    { key: 'shippedDate', label: 'Shipped Date', sortable: true },
  ], [])

  const storageKey = `sales_customer_orders_${customer.replace(/\W/g, '_')}`
  const table = useDataTable({ data: rows, columns: COLS, storageKey })

  return <DataTable table={table} data={rows} noun="order" exportFilename={storageKey} page={storageKey} />
}

// ─── Customer Drilldown Panel ────────────────────────────────────────────────

function CustomerDrilldown({ customer, orders, allMonthRows, onClose }: {
  customer: string
  orders: SalesOrder[]
  allMonthRows: MonthRow[]
  onClose: () => void
}) {
  const customerOrders = useMemo(() => orders.filter(o => (o.customer || 'Unknown') === customer), [orders, customer])
  const totalRev = customerOrders.reduce((s, o) => s + o.revenue, 0)
  const totalPL = customerOrders.reduce((s, o) => s + o.pl, 0)
  const margin = totalRev > 0 ? (totalPL / totalRev) * 100 : 0

  // Sparkline: this customer's monthly revenue for the last 12 months
  const sparkData: CustomerMonthlyPoint[] = useMemo(() => {
    const sorted = [...allMonthRows].sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    const last12 = sorted.slice(-12)
    return last12.map(m => {
      const custRev = m.orders
        .filter(o => (o.customer || 'Unknown') === customer)
        .reduce((s, o) => s + o.revenue, 0)
      return { month: m.monthLabel, revenue: custRev }
    })
  }, [allMonthRows, customer])

  return (
    <div className="space-y-4 rounded-xl border bg-card/50 p-4 shadow-sm ml-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Customer › <span className="text-foreground font-medium">{customer}</span></p>
          <h4 className="text-base font-bold mt-0.5">Customer Orders</h4>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="size-4 mr-1" /> Close</Button>
      </div>

      {/* Mini summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Package className="size-4" />} label="Orders" value={String(customerOrders.length)} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={<DollarSign className="size-4" />} label="Revenue" value={fmt(totalRev)} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={<TrendingUp className="size-4" />} label="P/L" value={fmt(totalPL)} color={totalPL >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} />
        <StatCard icon={<Percent className="size-4" />} label="Margin" value={`${margin.toFixed(1)}%`} color={margin >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} />
      </div>

      {/* Sparkline chart */}
      {sparkData.length > 1 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Monthly Revenue (Last 12 Months)</h5>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData}>
                <defs>
                  <linearGradient id={`custAreaGrad-${customer.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} width={50} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(v) => [fmt(v as number), 'Revenue']}
                />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill={`url(#custAreaGrad-${customer.replace(/\W/g, '')})`} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Orders table */}
      <div>
        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Orders</h5>
        <CustomerOrderSubTable orders={orders} customer={customer} />
      </div>
    </div>
  )
}

// ─── Customer Breakdown Table (Drilldown Level 1b) ──────────────────────────

function CustomerBreakdownTable({ orders, monthLabel, monthKey, allMonthRows }: {
  orders: SalesOrder[]
  monthLabel: string
  monthKey: string
  allMonthRows: MonthRow[]
}) {
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)

  // Build lookup for previous month and previous year customer aggregates
  const prevMonthCustomerMap = useMemo(() => {
    const prevKey = getPrevMonthKey(monthKey)
    const prevRow = allMonthRows.find(m => m.monthKey === prevKey)
    if (!prevRow) return null
    const map: Record<string, { revenue: number; pl: number }> = {}
    for (const o of prevRow.orders) {
      const k = o.customer || 'Unknown'
      if (!map[k]) map[k] = { revenue: 0, pl: 0 }
      map[k].revenue += o.revenue
      map[k].pl += o.pl
    }
    return map
  }, [monthKey, allMonthRows])

  const prevYearCustomerMap = useMemo(() => {
    const prevKey = getPrevYearMonthKey(monthKey)
    const prevRow = allMonthRows.find(m => m.monthKey === prevKey)
    if (!prevRow) return null
    const map: Record<string, { revenue: number; pl: number }> = {}
    for (const o of prevRow.orders) {
      const k = o.customer || 'Unknown'
      if (!map[k]) map[k] = { revenue: 0, pl: 0 }
      map[k].revenue += o.revenue
      map[k].pl += o.pl
    }
    return map
  }, [monthKey, allMonthRows])

  const rows: CustomerBreakdownRow[] = useMemo(() => {
    const byCustomer: Record<string, { orders: number; qty: number; revenue: number; pl: number }> = {}
    for (const o of orders) {
      const k = o.customer || 'Unknown'
      if (!byCustomer[k]) byCustomer[k] = { orders: 0, qty: 0, revenue: 0, pl: 0 }
      byCustomer[k].orders++
      byCustomer[k].qty += o.qty
      byCustomer[k].revenue += o.revenue
      byCustomer[k].pl += o.pl
    }
    return Object.entries(byCustomer)
      .map(([customer, s]) => {
        const prevM = prevMonthCustomerMap?.[customer]
        const prevY = prevYearCustomerMap?.[customer]
        return {
          customer,
          orderCount: s.orders,
          totalQty: s.qty,
          revenue: s.revenue,
          pl: s.pl,
          margin: s.revenue > 0 ? (s.pl / s.revenue) * 100 : 0,
          revMoM: prevM ? (prevM.revenue > 0 ? ((s.revenue - prevM.revenue) / prevM.revenue) * 100 : (s.revenue > 0 ? 100 : 0)) : null,
          revYoY: prevY ? (prevY.revenue > 0 ? ((s.revenue - prevY.revenue) / prevY.revenue) * 100 : (s.revenue > 0 ? 100 : 0)) : null,
          plMoM: prevM ? s.pl - prevM.pl : null,
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
  }, [orders, prevMonthCustomerMap, prevYearCustomerMap])

  const CUSTOMER_COLUMNS: ColumnDef<CustomerBreakdownRow>[] = useMemo(() => [
    {
      key: 'customer', label: 'Customer', sortable: true, filterable: true,
      render: (v, row) => {
        const r = row as CustomerBreakdownRow
        const isExpanded = expandedCustomer === r.customer
        return (
          <span className="flex items-center gap-1.5 font-semibold">
            {isExpanded ? <ChevronDown className="size-3.5 text-primary" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
            {v as string}
          </span>
        )
      },
    },
    { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400' : 'text-red-400'}>{(v as number).toFixed(1)}%</span> },
    { key: 'revMoM', label: 'Revenue MoM', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="pct" /> },
    { key: 'revYoY', label: 'Revenue YoY', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="pct" /> },
    { key: 'plMoM', label: 'P/L MoM', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="dollar" /> },
  ], [expandedCustomer])

  const storageKey = `sales_date_customers_${monthLabel.replace(/\W/g, '_')}`
  const table = useDataTable({ data: rows, columns: CUSTOMER_COLUMNS, storageKey })

  return (
    <DataTable
      table={table}
      data={rows}
      noun="customer"
      exportFilename={storageKey}
      page={storageKey}
      getRowKey={(row) => (row as CustomerBreakdownRow).customer}
      expandedRowKey={expandedCustomer}
      onRowClick={(row) => {
        const c = (row as CustomerBreakdownRow).customer
        setExpandedCustomer(prev => prev === c ? null : c)
      }}
      renderExpandedContent={(row) => {
        const r = row as CustomerBreakdownRow
        return (
          <CustomerDrilldown
            customer={r.customer}
            orders={orders}
            allMonthRows={allMonthRows}
            onClose={() => setExpandedCustomer(null)}
          />
        )
      }}
    />
  )
}

// ─── Month Drilldown Panel ───────────────────────────────────────────────────

function MonthDrilldown({ monthRow, allMonthRows, onClose }: { monthRow: MonthRow; allMonthRows: MonthRow[]; onClose: () => void }) {
  const totalQty = monthRow.totalQty
  const totalRev = monthRow.revenue
  const totalPL = monthRow.pl

  // MoM / YoY revenue comparisons for stat cards
  const monthLookup = useMemo(() => {
    const map: Record<string, MonthRow> = {}
    for (const m of allMonthRows) map[m.monthKey] = m
    return map
  }, [allMonthRows])

  const prevMonthRow = monthLookup[getPrevMonthKey(monthRow.monthKey)]
  const prevYearRow = monthLookup[getPrevYearMonthKey(monthRow.monthKey)]

  const momRevDelta = prevMonthRow ? totalRev - prevMonthRow.revenue : null
  const momRevPct = prevMonthRow && prevMonthRow.revenue > 0 ? ((totalRev - prevMonthRow.revenue) / prevMonthRow.revenue) * 100 : (prevMonthRow ? (totalRev > 0 ? 100 : 0) : null)
  const yoyRevDelta = prevYearRow ? totalRev - prevYearRow.revenue : null
  const yoyRevPct = prevYearRow && prevYearRow.revenue > 0 ? ((totalRev - prevYearRow.revenue) / prevYearRow.revenue) * 100 : (prevYearRow ? (totalRev > 0 ? 100 : 0) : null)

  return (
    <div className="space-y-4 rounded-xl border bg-card/50 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Months › <span className="text-foreground font-medium">{monthRow.monthLabel}</span></p>
          <h3 className="text-lg font-bold mt-0.5">Monthly Orders</h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}><X className="size-4 mr-1" /> Close</Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard icon={<Package className="size-4" />} label="Orders" value={String(monthRow.orderCount)} sub={`${monthRow.shippedCount}/${monthRow.orderCount} shipped`} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={<CalendarDays className="size-4" />} label="Total Qty" value={fmtN(totalQty)} color="bg-violet-500/10 text-violet-400" />
        <StatCard icon={<DollarSign className="size-4" />} label="Revenue" value={fmt(totalRev)} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={<TrendingUp className="size-4" />} label="P/L" value={fmt(totalPL)} sub={`${monthRow.margin.toFixed(1)}% margin`} color={totalPL >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} />
        <StatCard
          icon={<ArrowUpRight className="size-4" />}
          label="MoM Change"
          value={momRevDelta !== null ? fmt(momRevDelta) : '-'}
          sub={momRevPct !== null ? `${momRevPct >= 0 ? '+' : ''}${momRevPct.toFixed(1)}% vs prev month` : 'No prior month data'}
          color={momRevDelta !== null ? (momRevDelta >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400') : 'bg-gray-500/10 text-gray-400'}
        />
        <StatCard
          icon={<ArrowDownRight className="size-4" />}
          label="YoY Change"
          value={yoyRevDelta !== null ? fmt(yoyRevDelta) : '-'}
          sub={yoyRevPct !== null ? `${yoyRevPct >= 0 ? '+' : ''}${yoyRevPct.toFixed(1)}% vs same month LY` : 'No prior year data'}
          color={yoyRevDelta !== null ? (yoyRevDelta >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400') : 'bg-gray-500/10 text-gray-400'}
        />
      </div>

      {/* Monthly Orders Table */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">All Orders</h4>
        <MonthlyOrdersTable orders={monthRow.orders} monthLabel={monthRow.monthLabel} />
      </div>

      {/* Customer Breakdown */}
      <div>
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Customer Breakdown</h4>
        <CustomerBreakdownTable orders={monthRow.orders} monthLabel={monthRow.monthLabel} monthKey={monthRow.monthKey} allMonthRows={allMonthRows} />
      </div>
    </div>
  )
}

// ─── Custom Tooltip for Chart ────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; payload?: Record<string, unknown> }>; label?: string }) {
  if (!active || !payload) return null
  const shippedProfit = payload.find(p => p.name === 'Shipped Profit')?.value || 0
  const shippedLoss = payload.find(p => p.name === 'Shipped Loss')?.value || 0
  const forecastProfit = payload.find(p => p.name === 'Forecast Profit')?.value || 0
  const forecastLoss = payload.find(p => p.name === 'Forecast Loss')?.value || 0
  const shippedRevenue = payload.find(p => p.name === 'Shipped Revenue')?.value || 0
  const forecastRevenue = payload.find(p => p.name === 'Forecast Revenue')?.value || 0
  const revenue = shippedRevenue + forecastRevenue
  const totalPL = shippedProfit + shippedLoss + forecastProfit + forecastLoss
  const data = payload[0]?.payload as Record<string, unknown> | undefined
  const revMoM = data?.revMoM as number | null
  const revYoY = data?.revYoY as number | null
  const plMoM = data?.plMoM as number | null
  const plYoY = data?.plYoY as number | null

  const changeText = (val: number | null, suffix = '%') => {
    if (val === null) return <span className="text-muted-foreground">-</span>
    const color = val >= 0 ? 'text-emerald-400' : 'text-red-400'
    const arrow = val >= 0 ? '↑' : '↓'
    return <span className={color}>{arrow} {suffix === '%' ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` : fmt(val)}</span>
  }

  return (
    <div className="rounded-xl border bg-popover p-3 shadow-lg text-sm space-y-1.5 min-w-[220px]">
      <p className="font-semibold">{label}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-4"><span style={{ color: '#60a5fa' }}>Shipped Revenue</span><span>{fmt(shippedRevenue)}</span></div>
        <div className="flex justify-between gap-4"><span style={{ color: 'rgba(96,165,250,0.6)' }}>Forecast Revenue</span><span>{fmt(forecastRevenue)}</span></div>
        <div className="flex justify-between gap-4 font-semibold"><span className="text-muted-foreground">Total Revenue</span><span>{fmt(revenue)}</span></div>
        <hr className="border-border" />
        <div className="flex justify-between gap-4"><span style={{ color: 'rgba(56,161,105,0.9)' }}>Shipped P/L</span><span>{fmt(shippedProfit + shippedLoss)}</span></div>
        <div className="flex justify-between gap-4"><span style={{ color: 'rgba(56,161,105,0.5)' }}>Forecast P/L</span><span>{fmt(forecastProfit + forecastLoss)}</span></div>
        <hr className="border-border" />
        <div className="flex justify-between gap-4 font-semibold"><span>Total P/L</span><span className={totalPL >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt(totalPL)}</span></div>
        <hr className="border-border" />
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Revenue MoM</span>{changeText(revMoM)}</div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Revenue YoY</span>{changeText(revYoY)}</div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">P/L MoM</span>{changeText(plMoM, '$')}</div>
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">P/L YoY</span>{changeText(plYoY, '$')}</div>
      </div>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SalesDatesPage() {
  return <Suspense><SalesDatesContent /></Suspense>
}

function SalesDatesContent() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null)
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

  // ─── Filter orders by category ───
  const filteredOrders = useMemo(() => {
    if (!data) return []
    return filterByCategory(data.orders, categoryFilter)
  }, [data, categoryFilter])

  // ─── Aggregate by month using attribution date ───
  const monthRowsRaw = useMemo(() => {
    if (!filteredOrders.length && !data) return []
    const byMonth: Record<string, { orders: SalesOrder[]; shipped: number; qty: number; revenue: number; shippedPL: number; forecastPL: number; shippedRevenue: number; forecastRevenue: number; costs: number }> = {}

    for (const order of filteredOrders) {
      const dateStr = getAttributionDate(order)
      const monthKey = dateStr ? getMonthKey(dateStr) : null
      if (!monthKey) continue

      if (!byMonth[monthKey]) byMonth[monthKey] = { orders: [], shipped: 0, qty: 0, revenue: 0, shippedPL: 0, forecastPL: 0, shippedRevenue: 0, forecastRevenue: 0, costs: 0 }
      const m = byMonth[monthKey]
      m.orders.push(order)
      m.qty += order.qty
      m.revenue += order.revenue
      m.costs += order.totalCost || order.variableCost
      if (order.status === 'shipped') {
        m.shipped++
        m.shippedPL += order.pl
        m.shippedRevenue += order.revenue
      } else {
        m.forecastPL += order.pl
        m.forecastRevenue += order.revenue
      }
    }

    return Object.entries(byMonth)
      .map(([monthKey, m]) => {
        const pl = m.shippedPL + m.forecastPL
        return {
          monthKey,
          monthLabel: getMonthLabel(monthKey),
          statusText: `${m.shipped}/${m.orders.length} Shipped`,
          orderCount: m.orders.length,
          shippedCount: m.shipped,
          totalQty: m.qty,
          revenue: m.revenue,
          costs: m.costs,
          shippedPL: m.shippedPL,
          forecastPL: m.forecastPL,
          shippedRevenue: m.shippedRevenue,
          forecastRevenue: m.forecastRevenue,
          pl,
          margin: m.revenue > 0 ? (pl / m.revenue) * 100 : 0,
          orders: m.orders,
        }
      })
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
  }, [filteredOrders, data])

  // ─── Build lookup and compute MoM/YoY fields ───
  const monthRows: MonthRow[] = useMemo(() => {
    const lookup: Record<string, typeof monthRowsRaw[number]> = {}
    for (const m of monthRowsRaw) lookup[m.monthKey] = m

    return monthRowsRaw.map(m => {
      const prevM = lookup[getPrevMonthKey(m.monthKey)]
      const prevY = lookup[getPrevYearMonthKey(m.monthKey)]

      const revMoM = prevM ? (prevM.revenue > 0 ? ((m.revenue - prevM.revenue) / prevM.revenue) * 100 : (m.revenue > 0 ? 100 : 0)) : null
      const revYoY = prevY ? (prevY.revenue > 0 ? ((m.revenue - prevY.revenue) / prevY.revenue) * 100 : (m.revenue > 0 ? 100 : 0)) : null
      const plMoM = prevM ? m.pl - prevM.pl : null
      const plYoY = prevY ? m.pl - prevY.pl : null
      const marginMoM = prevM ? m.margin - prevM.margin : null
      const marginYoY = prevY ? m.margin - prevY.margin : null

      return { ...m, revMoM, revYoY, plMoM, plYoY, marginMoM, marginYoY }
    })
  }, [monthRowsRaw])

  // ─── Totals ───
  const totals = useMemo(() => {
    const totalOrders = monthRows.reduce((s, m) => s + m.orderCount, 0)
    const totalQty = monthRows.reduce((s, m) => s + m.totalQty, 0)
    const totalRevenue = monthRows.reduce((s, m) => s + m.revenue, 0)
    const totalPL = monthRows.reduce((s, m) => s + m.pl, 0)
    const margin = totalRevenue > 0 ? (totalPL / totalRevenue) * 100 : 0
    return { totalOrders, totalQty, totalRevenue, totalPL, margin, monthCount: monthRows.length }
  }, [monthRows])

  // ─── Chart data (sorted chronologically) ───
  const monthLookupForChart = useMemo(() => {
    const map: Record<string, MonthRow> = {}
    for (const m of monthRows) map[m.monthKey] = m
    return map
  }, [monthRows])

  const chartData = useMemo(() => {
    return [...monthRows]
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((m) => {
        const prevMonth = monthLookupForChart[getPrevMonthKey(m.monthKey)]
        const prevYear = monthLookupForChart[getPrevYearMonthKey(m.monthKey)]
        const revMoM = prevMonth ? ((m.revenue - prevMonth.revenue) / (prevMonth.revenue || 1)) * 100 : null
        const revYoY = prevYear ? ((m.revenue - prevYear.revenue) / (prevYear.revenue || 1)) * 100 : null
        const plMoM = prevMonth ? m.pl - prevMonth.pl : null
        const plYoY = prevYear ? m.pl - prevYear.pl : null
        return {
          month: m.monthLabel,
          shippedProfit: Math.max(0, m.shippedPL),
          shippedLoss: Math.min(0, m.shippedPL),
          forecastProfit: Math.max(0, m.forecastPL),
          forecastLoss: Math.min(0, m.forecastPL),
          revenue: m.revenue,
          shippedRevenue: m.shippedRevenue,
          forecastRevenue: m.forecastRevenue,
          revMoM, revYoY, plMoM, plYoY,
        }
      })
  }, [monthRows, monthLookupForChart])

  // ─── Month columns ───
  const MONTH_COLUMNS: ColumnDef<MonthRow>[] = useMemo(() => [
    {
      key: 'monthLabel',
      label: 'Month',
      sortable: true,
      filterable: true,
      render: (v, row) => {
        const r = row as MonthRow
        const isExpanded = expandedMonth === r.monthKey
        return (
          <span className="flex items-center gap-1.5 font-semibold">
            {isExpanded ? <ChevronDown className="size-3.5 text-primary" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
            {v as string}
          </span>
        )
      },
    },
    {
      key: 'statusText',
      label: 'Status',
      sortable: true,
      filterable: true,
      render: (v) => {
        const text = v as string
        const match = text.match(/^(\d+)\/(\d+)/)
        if (match) {
          const shipped = parseInt(match[1])
          const total = parseInt(match[2])
          const allShipped = shipped === total
          const cls = allShipped ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
          return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>{text}</span>
        }
        return <span>{text}</span>
      },
    },
    { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
    { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{(v as number).toFixed(1)}%</span> },
    { key: 'revMoM', label: 'Revenue MoM', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="pct" /> },
    { key: 'revYoY', label: 'Revenue YoY', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="pct" /> },
    { key: 'plMoM', label: 'P/L MoM', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="dollar" /> },
    { key: 'plYoY', label: 'P/L YoY', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="dollar" /> },
    { key: 'marginMoM', label: 'Margin MoM', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="pp" /> },
    { key: 'marginYoY', label: 'Margin YoY', sortable: true, render: (v) => <ChangeIndicator value={v as number | null} format="pp" /> },
  ], [expandedMonth])

  const table = useDataTable({ data: monthRows, columns: MONTH_COLUMNS, storageKey: 'sales-by-date' })

  // ─── Find expanded month row ───
  const expandedMonthRow = useMemo(() => {
    if (!expandedMonth) return null
    return monthRows.find((m) => m.monthKey === expandedMonth) || null
  }, [expandedMonth, monthRows])

  if (loading) return <TableSkeleton rows={8} />
  if (error || !data) return <div className="p-6"><div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"><p className="text-destructive">{error || 'Failed to load'}</p></div></div>

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header + Category Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">P/L by Date</h1>
          <p className="text-sm text-muted-foreground">Revenue and profit breakdown by month</p>
        </div>
        <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} />
      </div>

      {/* Stat Cards */}
      <StaggeredGrid className="grid grid-cols-2 lg:grid-cols-4 gap-3" stagger={100}>
        <StatCard icon={<Package className="size-4" />} label="Orders" value={fmtN(totals.totalOrders)} sub={`${fmtN(totals.totalQty)} units`} color="bg-blue-500/10 text-blue-400" />
        <StatCard icon={<DollarSign className="size-4" />} label="Revenue" value={fmt(totals.totalRevenue)} color="bg-emerald-500/10 text-emerald-400" />
        <StatCard icon={<TrendingUp className="size-4" />} label="P/L" value={fmt(totals.totalPL)} sub={`Margin: ${totals.margin.toFixed(1)}%`} color={totals.totalPL >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} />
        <StatCard icon={<Percent className="size-4" />} label="Margin" value={`${totals.margin.toFixed(1)}%`} sub={`${totals.monthCount} months`} color={totals.margin >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'} />
      </StaggeredGrid>

      {/* Monthly P/L Breakdown Chart */}
      <ScrollReveal delay={150}>
      <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-5 shadow-lg transition-all duration-200 hover:shadow-xl hover:border-white/[0.1]">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Monthly P/L Breakdown</h3>
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.85)' }} /> Shipped Profit</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.85)' }} /> Shipped Loss</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.35)' }} /> Forecast Profit</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.35)' }} /> Forecast Loss</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded-sm" style={{ background: '#60a5fa' }} /> Shipped Revenue</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded-sm border-b border-dashed" style={{ background: '#60a5fa', opacity: 0.5 }} /> Forecast Revenue</span>
          </div>
        </div>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} barGap={0} barCategoryGap="12%">
              <defs>
                <linearGradient id="shippedProfitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0.75} />
                </linearGradient>
                <linearGradient id="shippedLossGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#dc2626" stopOpacity={0.75} />
                </linearGradient>
                <linearGradient id="forecastProfitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#059669" stopOpacity={0.2} />
                </linearGradient>
                <linearGradient id="forecastLossGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#dc2626" stopOpacity={0.2} />
                </linearGradient>
                <filter id="barShadow">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity="0.15" />
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                dy={6}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={60}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                width={60}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.15, radius: 6 }} />
              {/* Stacked bars — shipped stack */}
              <Bar yAxisId="left" dataKey="shippedProfit" name="Shipped Profit" stackId="shipped" fill="url(#shippedProfitGrad)" radius={[6, 6, 0, 0]} animationBegin={200} animationDuration={800} animationEasing="ease-out" />
              <Bar yAxisId="left" dataKey="shippedLoss" name="Shipped Loss" stackId="shipped" fill="url(#shippedLossGrad)" radius={[0, 0, 6, 6]} animationBegin={200} animationDuration={800} animationEasing="ease-out" />
              {/* Stacked bars — forecast stack */}
              <Bar yAxisId="left" dataKey="forecastProfit" name="Forecast Profit" stackId="forecast" fill="url(#forecastProfitGrad)" radius={[6, 6, 0, 0]} animationBegin={400} animationDuration={800} animationEasing="ease-out" />
              <Bar yAxisId="left" dataKey="forecastLoss" name="Forecast Loss" stackId="forecast" fill="url(#forecastLossGrad)" radius={[0, 0, 6, 6]} animationBegin={400} animationDuration={800} animationEasing="ease-out" />
              {/* Shipped Revenue — solid line */}
              <Line yAxisId="right" type="monotone" dataKey="shippedRevenue" name="Shipped Revenue" stroke="#60a5fa" strokeWidth={2.5} dot={{ r: 3.5, fill: '#60a5fa', strokeWidth: 2, stroke: 'hsl(var(--card))' }} activeDot={{ r: 6, strokeWidth: 2, stroke: '#60a5fa', fill: 'hsl(var(--card))' }} animationBegin={600} animationDuration={1000} animationEasing="ease-out" />
              {/* Forecast Revenue — dashed line, lighter color */}
              <Line yAxisId="right" type="monotone" dataKey="forecastRevenue" name="Forecast Revenue" stroke="#60a5fa" strokeWidth={2} strokeDasharray="6 4" strokeOpacity={0.5} dot={{ r: 3, fill: '#60a5fa', strokeWidth: 1.5, stroke: 'hsl(var(--card))', opacity: 0.5 }} activeDot={{ r: 5, strokeWidth: 2, stroke: '#60a5fa', fill: 'hsl(var(--card))' }} animationBegin={700} animationDuration={1000} animationEasing="ease-out" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      </ScrollReveal>

      {/* Monthly Details Table */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Monthly Details</h3>
        <DataTable
          table={table}
          data={monthRows}
          noun="month"
          exportFilename="sales-by-date"
          page="sales-by-date"
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => (row as MonthRow).monthKey}
          expandedRowKey={expandedMonth}
          onRowClick={(row) => {
            const mk = (row as MonthRow).monthKey
            setExpandedMonth((prev) => (prev === mk ? null : mk))
          }}
          renderExpandedContent={(row) => {
            const r = row as MonthRow
            return <MonthDrilldown monthRow={r} allMonthRows={monthRows} onClose={() => setExpandedMonth(null)} />
          }}
        />
      </div>
    </div>
  )
}
