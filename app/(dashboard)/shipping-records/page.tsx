'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order } from '@/lib/google-sheets'

const DATE_FILTERS = [
  { key: '7', label: 'Last 7 Days' },
  { key: '30', label: 'Last 30 Days' },
  { key: '90', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
] as const

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

type DateKey = (typeof DATE_FILTERS)[number]['key']
type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']

type ShippingRecord = Order & {
  bolTracking: string
  carrier: string
}

type ShippingRecordRow = ShippingRecord & Record<string, unknown>

const COLUMNS: ColumnDef<ShippingRecordRow>[] = [
  { key: 'shippedDate', label: 'Ship Date', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'orderQty', label: 'Qty', sortable: true, render: (v) => (v as number).toLocaleString() },
  { key: 'bolTracking', label: 'BOL/Tracking', sortable: true, filterable: true },
  { key: 'carrier', label: 'Carrier', sortable: true, filterable: true },
]

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts.map(Number)
  return new Date(y, m - 1, d)
}

function filterByDate(records: ShippingRecord[], days: DateKey): ShippingRecord[] {
  if (days === 'all') return records
  const now = new Date()
  const cutoff = new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000)
  return records.filter((record) => {
    const shipped = parseDate(record.shippedDate)
    return shipped && shipped >= cutoff
  })
}

function filterByCategory(records: ShippingRecord[], filter: CategoryKey): ShippingRecord[] {
  switch (filter) {
    case 'rolltech':
      return records.filter((record) => record.category.toLowerCase().includes('roll'))
    case 'molding':
      return records.filter((record) => record.category.toLowerCase().includes('molding'))
    case 'snappad':
      return records.filter((record) => record.category.toLowerCase().includes('snap'))
    default:
      return records
  }
}

export default function ShippingRecordsPage() {
  const [records, setRecords] = useState<ShippingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateKey>('30')
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')

  useEffect(() => {
    fetch('/api/sheets')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch shipping records')
        return res.json()
      })
      .then((data: Order[]) => {
        const shippedRecords = data
          .filter((order) => order.internalStatus.toLowerCase() === 'shipped' || order.shippedDate)
          .map((order): ShippingRecord => ({
            ...order,
            // Placeholder until dedicated BOL/Tracking and Carrier columns exist.
            bolTracking: order.poNumber || '-',
            carrier: '-',
          }))
          .sort((a, b) => {
            const dateA = parseDate(a.shippedDate)
            const dateB = parseDate(b.shippedDate)
            if (!dateA && !dateB) return 0
            if (!dateA) return 1
            if (!dateB) return -1
            return dateB.getTime() - dateA.getTime()
          })

        setRecords(shippedRecords)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByCategory(filterByDate(records, dateFilter), categoryFilter) as ShippingRecordRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'shipping-records',
  })

  const totalShipments = filtered.length
  const totalUnitsShipped = filtered.reduce((sum, record) => sum + record.orderQty, 0)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">🚚 Shipping Records</h1>
      <p className="text-muted-foreground text-sm mb-4">Shipment history and tracking placeholders</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Total Shipments</p>
          <p className="text-xl font-bold text-green-600">{totalShipments}</p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Units Shipped</p>
          <p className="text-xl font-bold">{totalUnitsShipped.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {DATE_FILTERS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => setDateFilter(filter.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              dateFilter === filter.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {CATEGORY_FILTERS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => setCategoryFilter(filter.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === filter.key
                ? 'bg-green-600 text-white'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in filter ? `${filter.emoji} ` : ''}{filter.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun="shipment"
          exportFilename="shipping-records.csv"
          cardClassName={() => 'border-l-4 border-l-green-500'}
          renderCard={(row, index) => {
            const record = row as unknown as ShippingRecord
            return (
              <Card key={`${record.ifNumber}-${index}`} className="border-l-4 border-l-green-500">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <CardTitle className="text-lg">🚚 {record.customer}</CardTitle>
                      <p className="text-sm text-muted-foreground">{record.partNumber}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">
                      Shipped
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Ship Date</span>
                      <p className="font-semibold">{record.shippedDate || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty</span>
                      <p className="font-semibold">{record.orderQty.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">BOL/Tracking</span>
                      <p className="font-semibold text-xs">{record.bolTracking || '-'}</p>
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
