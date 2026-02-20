'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
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

interface PartRow extends Record<string, unknown> {
  partNumber: string
  category: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
  orders: SalesOrder[]
}

interface CustomerGroupRow extends Record<string, unknown> {
  customer: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
  orders: SalesOrder[]
}

interface OrderRow extends Record<string, unknown> {
  line: string
  customer: string
  qty: number
  revenue: number
  totalCost: number
  pl: number
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

const ORDER_COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'line', label: 'Line', sortable: true, filterable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'qty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'totalCost', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{fmt(v as number)}</span> },
  { key: 'shippedDate', label: 'Shipped', sortable: true, filterable: true },
  { key: 'status', label: 'Status', sortable: true, filterable: true },
]

const CUSTOMER_GROUP_COLUMNS: ColumnDef<CustomerGroupRow>[] = [
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'costs', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
  { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{(v as number).toFixed(1)}%</span> },
]

function OrdersDataTable({ orders, storageKey }: { orders: SalesOrder[]; storageKey: string }) {
  const rows: OrderRow[] = useMemo(() => orders.map((o) => ({
    line: o.line,
    customer: o.customer,
    qty: o.qty,
    revenue: o.revenue,
    totalCost: o.totalCost || o.variableCost,
    pl: o.pl,
    shippedDate: o.shippedDate,
    status: o.status,
  })), [orders])

  const table = useDataTable({ data: rows, columns: ORDER_COLUMNS, storageKey })

  return <DataTable table={table} data={rows} noun="order" exportFilename={storageKey} getRowKey={(r) => (r as OrderRow).line} />
}

function CustomersDataTable({ customerGroups, partNumber }: { customerGroups: [string, SalesOrder[]][]; partNumber: string }) {
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)

  const rows: CustomerGroupRow[] = useMemo(() => customerGroups.map(([customer, orders]) => {
    const totalQty = orders.reduce((s, o) => s + o.qty, 0)
    const revenue = orders.reduce((s, o) => s + o.revenue, 0)
    const costs = orders.reduce((s, o) => s + (o.totalCost || o.variableCost), 0)
    const pl = orders.reduce((s, o) => s + o.pl, 0)
    return { customer, orderCount: orders.length, totalQty, revenue, costs, pl, margin: revenue > 0 ? (pl / revenue) * 100 : 0, orders }
  }), [customerGroups])

  const table = useDataTable({ data: rows, columns: CUSTOMER_GROUP_COLUMNS, storageKey: `${partNumber}_customers` })

  return (
    <DataTable
      table={table}
      data={rows}
      noun="customer"
      exportFilename={`${partNumber}_customers`}
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

  const partSummaries: PartRow[] = useMemo(() => {
    if (!data) return []
    const byPart: Record<string, PartRow> = {}
    for (const o of data.orders) {
      const k = o.partNumber || 'Unknown'
      if (!byPart[k]) byPart[k] = { partNumber: k, category: o.category, orderCount: 0, totalQty: 0, revenue: 0, costs: 0, pl: 0, margin: 0, orders: [] }
      byPart[k].orderCount++
      byPart[k].totalQty += o.qty
      byPart[k].revenue += o.revenue
      byPart[k].costs += o.totalCost || o.variableCost
      byPart[k].pl += o.pl
      byPart[k].orders.push(o)
    }
    return Object.values(byPart).map((p) => ({ ...p, margin: p.revenue > 0 ? (p.pl / p.revenue) * 100 : 0 }))
  }, [data])

  const PART_COLUMNS: ColumnDef<PartRow>[] = useMemo(() => [
    { key: 'partNumber', label: t('table.partNumber'), sortable: true, filterable: true },
    {
      key: 'category',
      label: t('table.category'),
      sortable: true,
      filterable: true,
      render: (v) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CAT_CLS[v as string] || CAT_CLS.Other}`}>{v as string}</span>,
    },
    { key: 'orderCount', label: t('table.orders'), sortable: true, render: (v) => fmtN(v as number) },
    { key: 'totalQty', label: t('table.qty'), sortable: true, render: (v) => fmtN(v as number) },
    { key: 'revenue', label: t('table.revenue'), sortable: true, render: (v) => fmt(v as number) },
    { key: 'costs', label: t('salesOverview.totalCosts'), sortable: true, render: (v) => fmt(v as number) },
    { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'margin', label: t('salesOverview.avgMargin'), sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{(v as number).toFixed(1)}%</span> },
  ], [t])

  const table = useDataTable({ data: partSummaries, columns: PART_COLUMNS, storageKey: 'sales-by-part' })

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" /></div>
  if (error || !data) return <div className="p-6"><div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"><p className="text-destructive">{error || 'Failed'}</p></div></div>

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('page.salesByPart')}</h1>
        <p className="text-sm text-muted-foreground">{t('page.salesByPartSubtitle')}</p>
      </div>

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
