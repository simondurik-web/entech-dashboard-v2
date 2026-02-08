'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { AutoRefreshControl } from '@/components/ui/AutoRefreshControl'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { ShippingRecord } from '@/lib/google-sheets'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

const DATE_FILTERS = [
  { key: '7', label: 'Last 7 Days' },
  { key: '30', label: 'Last 30 Days' },
  { key: '90', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
] as const

type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']
type DateKey = (typeof DATE_FILTERS)[number]['key']

type ShippingRow = ShippingRecord & Record<string, unknown>

const COLUMNS: ColumnDef<ShippingRow>[] = [
  { key: 'shipDate', label: 'Ship Date', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'ifNumber', label: 'IF#', sortable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'carrier', label: 'Carrier', sortable: true, filterable: true },
  { key: 'bol', label: 'BOL#', sortable: true },
  { key: 'palletCount', label: 'Pallets', sortable: true },
  {
    key: 'photos',
    label: 'Photos',
    render: (v) => {
      const photos = v as string[]
      return photos.length > 0 ? `📷 ${photos.length}` : '-'
    },
  },
]

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

function filterByDate(records: ShippingRecord[], days: DateKey): ShippingRecord[] {
  if (days === 'all') return records
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - Number(days))
  return records.filter((r) => {
    const d = parseDate(r.shipDate || r.timestamp)
    return d && d >= cutoff
  })
}

function filterByCategory(records: ShippingRecord[], filter: CategoryKey): ShippingRecord[] {
  if (filter === 'all') return records
  return records.filter((r) => {
    const cat = r.category.toLowerCase()
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

export default function ShippingRecordsPage() {
  const [records, setRecords] = useState<ShippingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateKey>('30')
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/shipping-records')
      if (!res.ok) throw new Error('Failed to fetch shipping records')
      const data = await res.json()
      setRecords(data)
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

  const autoRefresh = useAutoRefresh({
    interval: 5 * 60 * 1000,
    onRefresh: () => fetchData(true),
  })

  const filtered = filterByCategory(filterByDate(records, dateFilter), categoryFilter) as ShippingRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'shipping-records',
  })

  const totalShipments = filtered.length
  const totalPallets = filtered.reduce((sum, r) => sum + r.palletCount, 0)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">🚛 Shipping Records</h1>
        <AutoRefreshControl
          isEnabled={autoRefresh.isAutoRefreshEnabled}
          onToggle={autoRefresh.toggleAutoRefresh}
          onRefreshNow={() => fetchData(true)}
          isRefreshing={refreshing}
          nextRefresh={autoRefresh.nextRefresh}
          lastRefresh={autoRefresh.lastRefresh}
        />
      </div>
      <p className="text-muted-foreground text-sm mb-4">Shipment history and tracking</p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Total Shipments</p>
          <p className="text-xl font-bold text-green-600">{totalShipments}</p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Pallets</p>
          <p className="text-xl font-bold">{totalPallets}</p>
        </div>
      </div>

      {/* Date filters */}
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

      {/* Category filters */}
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

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <DataTable
          table={table}
          data={filtered}
          noun="shipment"
          exportFilename="shipping-records.csv"
          cardClassName={() => 'border-l-4 border-l-green-500'}
          renderCard={(row, i) => {
            const record = row as unknown as ShippingRecord
            return (
              <Card key={`${record.ifNumber}-${i}`} className="border-l-4 border-l-green-500">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">🚚 {record.customer || 'Unknown'}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        IF# {record.ifNumber} • {record.carrier || 'Unknown carrier'}
                      </p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">
                      Shipped
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">Ship Date</span>
                      <p className="font-semibold">{record.shipDate || record.timestamp || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">BOL#</span>
                      <p className="font-semibold text-xs">{record.bol || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pallets</span>
                      <p className="font-semibold">{record.palletCount || '-'}</p>
                    </div>
                  </div>
                  {/* Photo thumbnails with lightbox */}
                  <PhotoGrid photos={record.photos} size="md" />
                </CardContent>
              </Card>
            )
          }}
        />
      )}
    </div>
  )
}
