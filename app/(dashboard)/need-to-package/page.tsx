'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order, InventoryItem } from '@/lib/google-sheets'
import { normalizeStatus } from '@/lib/google-sheets'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

interface PackageOrder extends Order {
  availableStock: number
  canPackage: boolean
}

type PackageRow = PackageOrder & Record<string, unknown>

const COLUMNS: ColumnDef<PackageRow>[] = [
  { key: 'line', label: 'Line', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'orderQty', label: 'Qty Needed', sortable: true, render: (v) => (v as number).toLocaleString() },
  {
    key: 'availableStock',
    label: 'In Stock',
    sortable: true,
    render: (v) => {
      const stock = v as number
      return <span className={stock > 0 ? 'text-green-600 font-semibold' : 'text-red-500'}>{stock.toLocaleString()}</span>
    },
  },
  {
    key: 'canPackage',
    label: 'Ready',
    sortable: true,
    render: (v) => (v ? <span className="text-green-600">✓ Yes</span> : <span className="text-red-500">✗ No</span>),
  },
  {
    key: 'daysUntilDue',
    label: 'Due',
    sortable: true,
    render: (v) => {
      const days = v as number | null
      if (days === null) return '-'
      if (days < 0) return <span className="text-red-500 font-semibold">Overdue</span>
      if (days <= 3) return <span className="text-orange-500 font-semibold">{days}d</span>
      return `${days}d`
    },
  },
  { key: 'ifNumber', label: 'IF#', sortable: true },
]

function filterByCategory(orders: PackageOrder[], filter: FilterKey): PackageOrder[] {
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

function borderColor(order: PackageOrder): string {
  if (order.canPackage) return 'border-l-green-500'
  if (order.daysUntilDue !== null && order.daysUntilDue < 0) return 'border-l-red-500'
  if (order.daysUntilDue !== null && order.daysUntilDue <= 3) return 'border-l-orange-500'
  return 'border-l-yellow-500'
}

export default function NeedToPackagePage() {
  const [orders, setOrders] = useState<PackageOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/sheets').then((res) => res.json()),
      fetch('/api/inventory').then((res) => res.json()),
    ])
      .then(([ordersData, inventoryData]: [Order[], InventoryItem[]]) => {
        // Build inventory map
        const stockMap = new Map<string, number>()
        inventoryData.forEach((item) => {
          stockMap.set(item.partNumber.toUpperCase(), item.inStock)
        })

        // Filter to orders that are in production (pending/wip) but not staged/shipped
        const needToPackage = ordersData
          .filter((o) => {
            const status = normalizeStatus(o.internalStatus, o.ifStatus)
            return (status === 'pending' || status === 'wip') && !o.shippedDate
          })
          .map((o): PackageOrder => {
            const stock = stockMap.get(o.partNumber.toUpperCase()) ?? 0
            return {
              ...o,
              availableStock: stock,
              canPackage: stock >= o.orderQty,
            }
          })
          // Sort by canPackage (ready first), then by due date
          .sort((a, b) => {
            if (a.canPackage !== b.canPackage) return b.canPackage ? 1 : -1
            return (a.daysUntilDue ?? 999) - (b.daysUntilDue ?? 999)
          })

        setOrders(needToPackage)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByCategory(orders, filter) as PackageRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'need-to-package',
  })

  // Stats
  const totalOrders = filtered.length
  const readyCount = filtered.filter((o) => o.canPackage).length
  const missingCount = filtered.filter((o) => !o.canPackage).length
  const urgentReady = filtered.filter((o) => o.canPackage && o.daysUntilDue !== null && o.daysUntilDue <= 3).length

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📦 Need to Package</h1>
      <p className="text-muted-foreground text-sm mb-4">Orders ready to be packaged based on inventory</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Orders</p>
          <p className="text-xl font-bold">{totalOrders}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Ready to Package</p>
          <p className="text-xl font-bold text-green-600">{readyCount}</p>
        </div>
        <div className="bg-red-500/10 rounded-lg p-3">
          <p className="text-xs text-red-500">Missing Stock</p>
          <p className="text-xl font-bold text-red-500">{missingCount}</p>
        </div>
        <div className="bg-orange-500/10 rounded-lg p-3">
          <p className="text-xs text-orange-500">Urgent & Ready</p>
          <p className="text-xl font-bold text-orange-500">{urgentReady}</p>
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
          exportFilename="need-to-package.csv"
          cardClassName={(row) => `border-l-4 ${borderColor(row as unknown as PackageOrder)}`}
          renderCard={(row, i) => {
            const order = row as unknown as PackageOrder
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
                      order.canPackage ? 'bg-green-500/20 text-green-600' : 'bg-red-500/20 text-red-600'
                    }`}>
                      {order.canPackage ? '✓ Ready' : '✗ Missing'}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Qty Needed</span>
                      <p className="font-semibold">{order.orderQty.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">In Stock</span>
                      <p className={`font-semibold ${order.availableStock >= order.orderQty ? 'text-green-600' : 'text-red-500'}`}>
                        {order.availableStock.toLocaleString()}
                      </p>
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
