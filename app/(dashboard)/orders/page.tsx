'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order } from '@/lib/google-sheets'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

const STATUS_FILTERS = [
  { key: 'pending', label: 'Need to Make', color: 'bg-yellow-500' },
  { key: 'wip', label: 'Making', color: 'bg-teal-500' },
  { key: 'staged', label: 'Ready to Ship', color: 'bg-green-500' },
  { key: 'shipped', label: 'Shipped', color: 'bg-gray-500' },
] as const

type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']
type StatusKey = (typeof STATUS_FILTERS)[number]['key']

type OrderRow = Order & Record<string, unknown>

const ORDER_COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'line', label: 'Line', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part #', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'orderQty', label: 'Qty', sortable: true, render: (v) => (v as number).toLocaleString() },
  {
    key: 'daysUntilDue',
    label: 'Due',
    sortable: true,
    render: (v) => {
      const days = v as number | null
      if (days === null) return '-'
      if (days < 0) return <span className="text-red-500 font-bold">Overdue</span>
      if (days <= 3) return <span className="text-orange-500 font-semibold">{days}d</span>
      return `${days}d`
    },
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
  { key: 'assignedTo', label: 'Assigned', filterable: true },
  { key: 'poNumber', label: 'PO#' },
  { key: 'requestedDate', label: 'Requested', sortable: true },
]

function statusColor(status: string): string {
  const s = status.toLowerCase()
  if (s === 'shipped') return 'bg-green-500/20 text-green-600'
  if (s === 'staged') return 'bg-green-500/20 text-green-600'
  if (s === 'invoiced') return 'bg-blue-500/20 text-blue-600'
  if (s === 'in production' || s === 'released') return 'bg-yellow-500/20 text-yellow-600'
  if (s === 'cancelled') return 'bg-red-500/20 text-red-600'
  return 'bg-muted text-muted-foreground'
}

function borderColor(order: Order): string {
  if (order.urgentOverride || order.priorityLevel >= 3) return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue < 0) return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue <= 3) return 'border-l-orange-500'
  if (order.internalStatus.toLowerCase() === 'shipped') return 'border-l-green-500'
  if (order.internalStatus.toLowerCase() === 'staged') return 'border-l-green-500'
  return 'border-l-blue-500'
}

function getOrderStatus(order: Order): StatusKey | null {
  const status = order.internalStatus.toLowerCase()
  if (status === 'shipped' || order.shippedDate) return 'shipped'
  if (status === 'staged') return 'staged'
  if (status === 'in production') return 'wip'
  if (status === 'released') return 'pending'
  return 'pending'
}

function filterByCategory(orders: Order[], filter: CategoryKey): Order[] {
  if (filter === 'all') return orders
  return orders.filter((o) => {
    const cat = o.category.toLowerCase()
    switch (filter) {
      case 'rolltech':
        return cat.includes('roll')
      case 'molding':
        return cat.includes('molding')
      case 'snappad':
        return cat.includes('snap')
      default:
        return true
    }
  })
}

function filterByStatus(orders: Order[], activeStatuses: Set<StatusKey>): Order[] {
  if (activeStatuses.size === 0) return orders
  return orders.filter((o) => {
    const status = getOrderStatus(o)
    return status && activeStatuses.has(status)
  })
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')
  const [activeStatuses, setActiveStatuses] = useState<Set<StatusKey>>(
    new Set(['pending', 'wip', 'staged'])
  )

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

  const toggleStatus = (status: StatusKey) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  const filtered = filterByStatus(filterByCategory(orders, categoryFilter), activeStatuses) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: ORDER_COLUMNS,
    storageKey: 'orders',
  })

  // Stats
  const totalOrders = filtered.length
  const totalUnits = filtered.reduce((sum, o) => sum + o.orderQty, 0)
  const needToMake = orders.filter((o) => getOrderStatus(o) === 'pending').length
  const making = orders.filter((o) => getOrderStatus(o) === 'wip').length
  const readyToShip = orders.filter((o) => getOrderStatus(o) === 'staged').length

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📋 Orders Data</h1>
      <p className="text-muted-foreground text-sm mb-4">Complete order database with all statuses</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Orders</p>
          <p className="text-xl font-bold">{totalOrders}</p>
          <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString()} units</p>
        </div>
        <div className="bg-yellow-500/10 rounded-lg p-3">
          <p className="text-xs text-yellow-600">Need to Make</p>
          <p className="text-xl font-bold text-yellow-600">{needToMake}</p>
        </div>
        <div className="bg-teal-500/10 rounded-lg p-3">
          <p className="text-xs text-teal-600">Making</p>
          <p className="text-xl font-bold text-teal-600">{making}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Ready to Ship</p>
          <p className="text-xl font-bold text-green-600">{readyToShip}</p>
        </div>
      </div>

      {/* Category filters */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCategoryFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in f ? `${f.emoji} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Status filters (toggleable) */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <span className="text-xs text-muted-foreground self-center mr-1">Status:</span>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleStatus(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              activeStatuses.has(f.key)
                ? `${f.color} text-white`
                : 'bg-muted hover:bg-muted/80 opacity-50'
            }`}
          >
            {f.label}
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
                        Line {order.line} • {order.partNumber}
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
                      <p className={`font-semibold ${
                        order.daysUntilDue !== null && order.daysUntilDue < 0 ? 'text-red-500' :
                        order.daysUntilDue !== null && order.daysUntilDue <= 3 ? 'text-orange-500' : ''
                      }`}>
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
