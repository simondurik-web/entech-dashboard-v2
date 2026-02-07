'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order } from '@/lib/google-sheets'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'urgent', label: 'Urgent', emoji: '🔴' },
  { key: 'due', label: 'Due This Week', emoji: '📅' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

// Cast Order to work with Record<string, unknown> constraint
type OrderRow = Order & Record<string, unknown>

const ORDER_COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'line', label: 'Line', sortable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'orderQty', label: 'Qty', sortable: true, render: (v) => (v as number).toLocaleString() },
  {
    key: 'daysUntilDue',
    label: 'Due',
    sortable: true,
    render: (v) => (v !== null ? `${v}d` : '-'),
  },
  { key: 'ifNumber', label: 'IF#', sortable: true },
  {
    key: 'internalStatus',
    label: 'Status',
    sortable: true,
    filterable: true,
    render: (v) => {
      const status = String(v || '')
      return (
        <span className={`px-2 py-0.5 text-xs rounded ${statusColor(status)}`}>
          {status || 'N/A'}
        </span>
      )
    },
  },
  { key: 'priorityLevel', label: 'Priority', sortable: true },
  { key: 'poNumber', label: 'PO#' },
  { key: 'assignedTo', label: 'Assigned To', filterable: true },
  { key: 'requestedDate', label: 'Requested', sortable: true },
  { key: 'shippedDate', label: 'Shipped' },
]

function statusColor(status: string): string {
  const s = status.toLowerCase()
  if (s === 'shipped') return 'bg-green-500/20 text-green-600'
  if (s === 'invoiced') return 'bg-blue-500/20 text-blue-600'
  if (s === 'in production' || s === 'released') return 'bg-yellow-500/20 text-yellow-600'
  if (s === 'cancelled') return 'bg-red-500/20 text-red-600'
  return 'bg-muted text-muted-foreground'
}

function borderColor(order: Order): string {
  if (order.urgentOverride || order.priorityLevel >= 3) return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue <= 3) return 'border-l-orange-500'
  if (order.internalStatus.toLowerCase() === 'shipped') return 'border-l-green-500'
  return 'border-l-blue-500'
}

function preFilter(orders: Order[], filter: FilterKey): Order[] {
  switch (filter) {
    case 'urgent':
      return orders.filter((o) => o.urgentOverride || o.priorityLevel >= 3)
    case 'due':
      return orders.filter((o) => o.daysUntilDue !== null && o.daysUntilDue >= 0 && o.daysUntilDue <= 7)
    case 'rolltech':
      return orders.filter((o) => o.category.toLowerCase().includes('roll'))
    case 'molding':
      return orders.filter((o) => o.category.toLowerCase().includes('molding'))
    case 'snappad':
      return orders.filter((o) => o.category.toLowerCase().includes('snap'))
    default:
      return orders
  }
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  useEffect(() => {
    fetch('/api/sheets')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch orders')
        return res.json()
      })
      .then((data) => setOrders(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = preFilter(orders, filter) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: ORDER_COLUMNS,
    storageKey: 'orders',
  })

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Orders</h1>

      {/* Category filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in f ? `${f.emoji} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {/* Data table */}
      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun="order"
          exportFilename="orders.csv"
          cardClassName={(row) => `border-l-4 ${borderColor(row as unknown as Order)}`}
          renderCard={(row, i) => {
            const order = row as unknown as Order
            return (
              <Card key={`${order.ifNumber}-${i}`} className={`border-l-4 ${borderColor(order)}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{order.customer}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Line {order.line} &middot; {order.partNumber}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${statusColor(order.internalStatus)}`}>
                      {order.internalStatus || 'N/A'}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Qty</span>
                      <p className="font-semibold">{order.orderQty.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Due</span>
                      <p className="font-semibold">
                        {order.daysUntilDue !== null ? `${order.daysUntilDue}d` : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">IF#</span>
                      <p className="font-semibold text-xs">{order.ifNumber || '-'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          }}
        />
      )}
    </div>
  )
}
