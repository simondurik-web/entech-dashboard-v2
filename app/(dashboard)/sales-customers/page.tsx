'use client'

import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'

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

interface OrderRow extends Record<string, unknown> {
  line: string
  partNumber: string
  category: string
  qty: number
  revenue: number
  pl: number
  shippedDate: string
  status: string
}

function fmt(v: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v) }
function fmtN(v: number) { return new Intl.NumberFormat('en-US').format(Math.round(v)) }

const CATEGORY_CLASSES: Record<string, string> = {
  'Roll Tech': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  Molding: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  'Snap Pad': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  Other: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
}

const ORDER_COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'line', label: 'Line', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true, render: (v) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CATEGORY_CLASSES[v as string] || CATEGORY_CLASSES.Other}`}>{v as string}</span> },
  { key: 'qty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{fmt(v as number)}</span> },
  { key: 'shippedDate', label: 'Shipped', sortable: true, filterable: true },
  { key: 'status', label: 'Status', sortable: true, filterable: true },
]

const CUSTOMER_COLUMNS: ColumnDef<CustomerRow>[] = [
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'orderCount', label: 'Orders', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'totalQty', label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'revenue', label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'costs', label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'pl', label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
  { key: 'margin', label: 'Margin', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{(v as number).toFixed(1)}%</span> },
]

function OrdersDataTable({ orders, storageKey }: { orders: SalesOrder[]; storageKey: string }) {
  const rows: OrderRow[] = useMemo(() => orders.map((o) => ({
    line: o.line,
    partNumber: o.partNumber,
    category: o.category,
    qty: o.qty,
    revenue: o.revenue,
    pl: o.pl,
    shippedDate: o.shippedDate,
    status: o.status,
  })), [orders])

  const table = useDataTable({ data: rows, columns: ORDER_COLUMNS, storageKey })
  return <DataTable table={table} data={rows} noun="order" exportFilename={storageKey} />
}

export default function SalesCustomersPage() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null)
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
        getRowKey={(row) => (row as CustomerRow).customer}
        expandedRowKey={expandedCustomer}
        onRowClick={(row) => {
          const c = (row as CustomerRow).customer
          setExpandedCustomer((prev) => (prev === c ? null : c))
        }}
        renderExpandedContent={(row) => {
          const r = row as CustomerRow
          return <OrdersDataTable orders={r.orders} storageKey={`sales_customer_${r.customer.replace(/\W/g, '_')}`} />
        }}
      />
    </div>
  )
}
