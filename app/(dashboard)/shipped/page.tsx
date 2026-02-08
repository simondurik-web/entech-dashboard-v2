'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { OrderDetail } from '@/components/OrderDetail'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order } from '@/lib/google-sheets'
import { normalizeStatus } from '@/lib/google-sheets'

const DATE_FILTERS = [
  { key: 'all', label: 'All Time' },
  { key: '7', label: 'Last 7 Days' },
  { key: '30', label: 'Last 30 Days' },
  { key: '90', label: 'Last 90 Days' },
] as const

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

type DateKey = (typeof DATE_FILTERS)[number]['key']
type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']

type OrderRow = Order & Record<string, unknown>

const COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'shippedDate', label: 'Ship Date', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'orderQty', label: 'Qty', sortable: true, render: (v) => (v as number).toLocaleString() },
  { key: 'line', label: 'Line', sortable: true },
  { key: 'ifNumber', label: 'IF#', sortable: true },
  { key: 'poNumber', label: 'PO#' },
]

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts.map(Number)
  return new Date(y, m - 1, d)
}

function filterByDate(orders: Order[], days: DateKey): Order[] {
  if (days === 'all') return orders
  const now = new Date()
  const cutoff = new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000)
  return orders.filter((o) => {
    const shipped = parseDate(o.shippedDate)
    return shipped && shipped >= cutoff
  })
}

function filterByCategory(orders: Order[], filter: CategoryKey): Order[] {
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

export default function ShippedPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateKey>('30')
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)

  const getOrderKey = (order: Order): string => `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`

  const toggleExpanded = (order: Order) => {
    const key = getOrderKey(order)
    setExpandedOrderKey((prev) => (prev === key ? null : key))
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/sheets')
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data: Order[] = await res.json()
      // Filter to shipped orders, sort by ship date descending
      const shipped = data
        .filter((o) => normalizeStatus(o.internalStatus, o.ifStatus) === 'shipped' || o.shippedDate)
        .sort((a, b) => {
          const dateA = parseDate(a.shippedDate)
          const dateB = parseDate(b.shippedDate)
          if (!dateA && !dateB) return 0
          if (!dateA) return 1
          if (!dateB) return -1
          return dateB.getTime() - dateA.getTime()
        })
      setOrders(shipped)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filtered = filterByCategory(filterByDate(orders, dateFilter), categoryFilter) as OrderRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'shipped',
  })

  // Stats
  const totalShipped = filtered.length
  const totalUnits = filtered.reduce((sum, o) => sum + o.orderQty, 0)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">🚚 Shipped</h1>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">Completed shipments</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Total Shipments</p>
          <p className="text-xl font-bold text-green-600">{totalShipped}</p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Units</p>
          <p className="text-xl font-bold">{totalUnits.toLocaleString()}</p>
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {DATE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setDateFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              dateFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Category filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCategoryFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === f.key
                ? 'bg-green-600 text-white'
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
          noun="shipment"
          exportFilename="shipped.csv"
          getRowKey={(row) => getOrderKey(row as unknown as Order)}
          expandedRowKey={expandedOrderKey}
          onRowClick={(row) => toggleExpanded(row as unknown as Order)}
          renderExpandedContent={(row) => {
            const order = row as unknown as Order
            return (
              <OrderDetail
                ifNumber={order.ifNumber}
                line={order.line}
                isShipped={true}
                shippedDate={order.shippedDate}
                partNumber={order.partNumber}
                tirePartNum={order.tire}
                hubPartNum={order.hub}
                onClose={() => setExpandedOrderKey(null)}
              />
            )
          }}
          cardClassName={() => 'border-l-4 border-l-green-500'}
          renderCard={(row, i) => {
            const order = row as unknown as Order
            const isExpanded = expandedOrderKey === getOrderKey(order)
            return (
              <Card 
                key={`${order.ifNumber}-${i}`} 
                className={`border-l-4 border-l-green-500 cursor-pointer transition-colors ${isExpanded ? 'bg-muted/20' : ''}`}
                onClick={() => toggleExpanded(order)}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{order.customer}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        Line {order.line} &middot; {order.partNumber}
                      </p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">
                      Shipped
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
                      <span className="text-muted-foreground">Ship Date</span>
                      <p className="font-semibold">{order.shippedDate || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">IF#</span>
                      <p className="font-semibold text-xs">{order.ifNumber || '-'}</p>
                    </div>
                  </div>
                  {/* Expandable content */}
                  <div
                    className={`grid transition-all duration-300 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}
                  >
                    <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
                      {isExpanded && (
                        <OrderDetail
                          ifNumber={order.ifNumber}
                          line={order.line}
                          isShipped={true}
                          shippedDate={order.shippedDate}
                          partNumber={order.partNumber}
                          tirePartNum={order.tire}
                          hubPartNum={order.hub}
                          onClose={() => setExpandedOrderKey(null)}
                        />
                      )}
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
