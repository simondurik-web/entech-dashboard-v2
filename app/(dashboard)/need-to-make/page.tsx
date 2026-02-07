'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order } from '@/lib/google-sheets'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

type OrderRow = Order & Record<string, unknown>

const COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'line', label: 'Line', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'orderQty', label: 'Qty Ordered', sortable: true, render: (v) => (v as number).toLocaleString() },
  {
    key: 'daysUntilDue',
    label: 'Due',
    sortable: true,
    render: (v) => {
      const days = v as number | null
      if (days === null) return '-'
      if (days < 0) return <span className="text-red-500 font-semibold">Overdue {Math.abs(days)}d</span>
      if (days <= 3) return <span className="text-orange-500 font-semibold">{days}d</span>
      return `${days}d`
    },
  },
  {
    key: 'internalStatus',
    label: 'Status',
    sortable: true,
    filterable: true,
    render: (v) => {
      const status = String(v || '')
      const color = status.toLowerCase() === 'released' 
        ? 'bg-yellow-500/20 text-yellow-600'
        : status.toLowerCase() === 'in production'
        ? 'bg-blue-500/20 text-blue-600'
        : 'bg-muted text-muted-foreground'
      return <span className={`px-2 py-0.5 text-xs rounded ${color}`}>{status || 'N/A'}</span>
    },
  },
  { key: 'assignedTo', label: 'Assigned To', filterable: true },
  { key: 'ifNumber', label: 'IF#', sortable: true },
]

function filterByCategory(orders: Order[], filter: FilterKey): Order[] {
  switch (filter) {
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

function borderColor(order: Order): string {
  if (order.daysUntilDue !== null && order.daysUntilDue < 0) return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue <= 3) return 'border-l-orange-500'
  if (order.internalStatus.toLowerCase() === 'in production') return 'border-l-blue-500'
  return 'border-l-yellow-500'
}

export default function NeedToMakePage() {
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
      .then((data: Order[]) => {
        // Filter to "Need to Make": Released or In Production, not shipped
        const needToMake = data.filter((o) => {
          const status = o.internalStatus.toLowerCase()
          return (status === 'released' || status === 'in production') && !o.shippedDate
        })
        setOrders(needToMake)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByCategory(orders, filter) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'need-to-make',
  })

  // Stats
  const totalOrders = filtered.length
  const totalUnits = filtered.reduce((sum, o) => sum + o.orderQty, 0)
  const overdueCount = filtered.filter((o) => o.daysUntilDue !== null && o.daysUntilDue < 0).length
  const dueThisWeek = filtered.filter((o) => o.daysUntilDue !== null && o.daysUntilDue >= 0 && o.daysUntilDue <= 7).length

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">🏭 Need to Make</h1>
      <p className="text-muted-foreground text-sm mb-4">Orders in production queue</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Orders</p>
          <p className="text-xl font-bold">{totalOrders}</p>
          <p className="text-xs text-muted-foreground">{totalUnits.toLocaleString()} units</p>
        </div>
        <div className="bg-red-500/10 rounded-lg p-3">
          <p className="text-xs text-red-500">Overdue</p>
          <p className="text-xl font-bold text-red-500">{overdueCount}</p>
        </div>
        <div className="bg-orange-500/10 rounded-lg p-3">
          <p className="text-xs text-orange-500">Due This Week</p>
          <p className="text-xl font-bold text-orange-500">{dueThisWeek}</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-500">In Production</p>
          <p className="text-xl font-bold text-blue-500">
            {filtered.filter((o) => o.internalStatus.toLowerCase() === 'in production').length}
          </p>
        </div>
      </div>

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
          exportFilename="need-to-make.csv"
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
                    <span className={`px-2 py-1 text-xs rounded ${
                      order.internalStatus.toLowerCase() === 'in production'
                        ? 'bg-blue-500/20 text-blue-600'
                        : 'bg-yellow-500/20 text-yellow-600'
                    }`}>
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
                      <span className="text-muted-foreground">Assigned</span>
                      <p className="font-semibold text-xs">{order.assignedTo || '-'}</p>
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
