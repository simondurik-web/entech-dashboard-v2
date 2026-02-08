'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { AutoRefreshControl } from '@/components/ui/AutoRefreshControl'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import type { PalletRecord } from '@/lib/google-sheets'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech' },
  { key: 'molding', label: 'Molding' },
  { key: 'snappad', label: 'Snap Pad' },
] as const

const DATE_FILTERS = [
  { key: '7', label: 'Last 7 Days' },
  { key: '30', label: 'Last 30 Days' },
  { key: '90', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
] as const

type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']
type DateKey = (typeof DATE_FILTERS)[number]['key']

type PalletRow = PalletRecord & Record<string, unknown>

const COLUMNS: ColumnDef<PalletRow>[] = [
  { key: 'timestamp', label: 'Date', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'ifNumber', label: 'IF#', sortable: true },
  { key: 'palletNumber', label: 'Pallet #', sortable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'weight', label: 'Weight', sortable: true },
  { key: 'partsPerPallet', label: 'Parts/Pallet' },
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

function filterByDate(records: PalletRecord[], days: DateKey): PalletRecord[] {
  if (days === 'all') return records
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - Number(days))
  return records.filter((r) => {
    const d = parseDate(r.timestamp)
    return d && d >= cutoff
  })
}

function filterByCategory(records: PalletRecord[], filter: CategoryKey): PalletRecord[] {
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

export default function PalletRecordsPage() {
  const [records, setRecords] = useState<PalletRecord[]>([])
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
      const res = await fetch('/api/pallet-records')
      if (!res.ok) throw new Error('Failed to fetch pallet records')
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

  const filtered = filterByCategory(filterByDate(records, dateFilter), categoryFilter) as PalletRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'pallet-records',
  })

  const totalPallets = filtered.length
  const totalWithPhotos = filtered.filter((r) => r.photos.length > 0).length

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📷 Pallet Records</h1>
        <AutoRefreshControl
          isEnabled={autoRefresh.isAutoRefreshEnabled}
          onToggle={autoRefresh.toggleAutoRefresh}
          onRefreshNow={() => fetchData(true)}
          isRefreshing={refreshing}
          nextRefresh={autoRefresh.nextRefresh}
          lastRefresh={autoRefresh.lastRefresh}
        />
      </div>
      <p className="text-muted-foreground text-sm mb-4">Pallet photos and dimension records</p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Pallets</p>
          <p className="text-xl font-bold">{totalPallets}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">With Photos</p>
          <p className="text-xl font-bold text-green-600">{totalWithPhotos}</p>
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
            {f.label}
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
          noun="pallet"
          exportFilename="pallet-records.csv"
          cardClassName={() => 'border-l-4 border-l-green-500'}
          renderCard={(row, i) => {
            const record = row as unknown as PalletRecord
            return (
              <Card key={`${record.ifNumber}-${i}`} className="border-l-4 border-l-green-500">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{record.customer || 'Unknown'}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        IF# {record.ifNumber} • Pallet #{record.palletNumber}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{record.timestamp}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">Weight</span>
                      <p className="font-semibold">{record.weight || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Parts/Pallet</span>
                      <p className="font-semibold">{record.partsPerPallet || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Category</span>
                      <p className="font-semibold text-xs">{record.category || '-'}</p>
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
