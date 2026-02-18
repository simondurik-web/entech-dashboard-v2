'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { AutoRefreshControl } from '@/components/ui/AutoRefreshControl'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { getDriveThumbUrl } from '@/lib/drive-utils'
import type { PalletRecord } from '@/lib/google-sheets'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech' },
  { key: 'molding', label: 'Molding' },
  { key: 'snappad', label: 'Snap Pad' },
] as const

type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']
type PalletRow = PalletRecord & { _parsed: Date | null } & Record<string, unknown>

/**
 * Parse Google Sheets Date(year,month,day,h,m,s) format
 * Month is 0-indexed in Sheets format
 */
function parseGSheetsDate(dateStr: string): Date | null {
  if (!dateStr) return null
  // Google Sheets: Date(2025,8,29,17,22,29) — month is 0-indexed
  const m = dateStr.match(/^Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$/)
  if (m) {
    return new Date(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6])
  }
  // Fallback: try native parsing
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

function formatDate(d: Date | null): string {
  if (!d) return '-'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const COLUMNS: ColumnDef<PalletRow>[] = [
  {
    key: 'timestamp',
    label: 'Date',
    sortable: true,
    render: (_v, row) => formatDate((row as PalletRow)._parsed),
  },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'ifNumber', label: 'IF#', sortable: true },
  { key: 'palletNumber', label: 'Pallet #', sortable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
  { key: 'weight', label: 'Weight', sortable: true },
  { key: 'dimensions', label: 'Dimensions' },
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

export default function PalletRecordsPage() {
  const [records, setRecords] = useState<PalletRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')

  // Date range — default to last 30 days
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return toDateInputValue(d)
  })
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()))

  // Quick date range presets
  const setPreset = (days: number | 'all') => {
    if (days === 'all') {
      setStartDate('')
      setEndDate('')
    } else {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - days)
      setStartDate(toDateInputValue(start))
      setEndDate(toDateInputValue(end))
    }
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/pallet-records')
      if (!res.ok) throw new Error('Failed to fetch pallet records')
      const data: PalletRecord[] = await res.json()
      // Pre-parse dates
      const parsed: PalletRow[] = data.map((r) => ({
        ...r,
        _parsed: parseGSheetsDate(r.timestamp),
      }))
      // Sort newest first
      parsed.sort((a, b) => (b._parsed?.getTime() ?? 0) - (a._parsed?.getTime() ?? 0))
      setRecords(parsed)
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

  const filtered = useMemo(() => {
    let result = records

    // Date range filter
    if (startDate) {
      const start = new Date(startDate + 'T00:00:00')
      result = result.filter((r) => r._parsed && r._parsed >= start)
    }
    if (endDate) {
      const end = new Date(endDate + 'T23:59:59')
      result = result.filter((r) => r._parsed && r._parsed <= end)
    }

    // Category filter
    if (categoryFilter !== 'all') {
      result = result.filter((r) => {
        const cat = r.category.toLowerCase()
        switch (categoryFilter) {
          case 'rolltech': return cat.includes('roll')
          case 'molding': return cat.includes('molding')
          case 'snappad': return cat.includes('snap')
          default: return true
        }
      })
    }

    return result
  }, [records, startDate, endDate, categoryFilter])

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'pallet-records',
  })

  const totalPallets = filtered.length
  const totalWithPhotos = filtered.filter((r) => r.photos.length > 0).length
  const totalPhotos = filtered.reduce((sum, r) => sum + r.photos.length, 0)

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
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Pallets</p>
          <p className="text-xl font-bold">{totalPallets}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">With Photos</p>
          <p className="text-xl font-bold text-green-600">{totalWithPhotos}</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-600">Total Photos</p>
          <p className="text-xl font-bold text-blue-600">{totalPhotos}</p>
        </div>
      </div>

      {/* Date Range */}
      <div className="mb-3">
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {[
            { label: '7 Days', days: 7 },
            { label: '30 Days', days: 30 },
            { label: '90 Days', days: 90 },
            { label: 'All Time', days: 'all' as const },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.days)}
              className="px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors bg-muted hover:bg-muted/80"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-muted rounded-lg px-3 py-1.5 text-sm border-none outline-none"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-muted rounded-lg px-3 py-1.5 text-sm border-none outline-none"
          />
        </div>
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
            const record = row as unknown as PalletRow
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
                    <span className="text-xs text-muted-foreground">
                      {formatDate(record._parsed)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">Weight</span>
                      <p className="font-semibold">{record.weight || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Dimensions</span>
                      <p className="font-semibold text-xs">{record.dimensions || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Parts/Pallet</span>
                      <p className="font-semibold">{record.partsPerPallet || '-'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <span className="bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full">
                      {record.category || 'Uncategorized'}
                    </span>
                    {record.orderNumber && <span>Order: {record.orderNumber}</span>}
                  </div>
                  {/* Photo thumbnails with hover enlarge + lightbox carousel */}
                  <PhotoGrid
                    photos={record.photos}
                    size="md"
                    context={{ ifNumber: record.ifNumber }}
                  />
                </CardContent>
              </Card>
            )
          }}
        />
      )}
    </div>
  )
}
