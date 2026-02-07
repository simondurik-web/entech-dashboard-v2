'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { ImageModal } from '@/components/ImageModal'
import type { StagedRecord } from '@/lib/google-sheets'

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

type StagedRow = StagedRecord & Record<string, unknown>

const COLUMNS: ColumnDef<StagedRow>[] = [
  { key: 'timestamp', label: 'Date Staged', sortable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  { key: 'ifNumber', label: 'IF#', sortable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'quantity', label: 'Qty', sortable: true },
  { key: 'location', label: 'Location', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
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

function filterByDate(records: StagedRecord[], days: DateKey): StagedRecord[] {
  if (days === 'all') return records
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - Number(days))
  return records.filter((r) => {
    const d = parseDate(r.timestamp)
    return d && d >= cutoff
  })
}

function filterByCategory(records: StagedRecord[], filter: CategoryKey): StagedRecord[] {
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

export default function StagedRecordsPage() {
  const [records, setRecords] = useState<StagedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateKey>('30')
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')
  const [modalImage, setModalImage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/staged-records')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch staged records')
        return res.json()
      })
      .then((data: StagedRecord[]) => setRecords(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByCategory(filterByDate(records, dateFilter), categoryFilter) as StagedRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'staged-records',
  })

  const totalStaged = filtered.length
  const totalUnits = filtered.reduce((sum, r) => sum + r.quantity, 0)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📦 Staged Records</h1>
      <p className="text-muted-foreground text-sm mb-4">Items staged and ready for shipment</p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Staged</p>
          <p className="text-xl font-bold">{totalStaged}</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-600">Total Units</p>
          <p className="text-xl font-bold text-blue-600">{totalUnits.toLocaleString()}</p>
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
                ? 'bg-blue-600 text-white'
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
          noun="record"
          exportFilename="staged-records.csv"
          cardClassName={() => 'border-l-4 border-l-blue-500'}
          renderCard={(row, i) => {
            const record = row as unknown as StagedRecord
            return (
              <Card key={`${record.ifNumber}-${i}`} className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">📦 {record.partNumber || 'Unknown'}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        IF# {record.ifNumber} • {record.customer || 'Unknown'}
                      </p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-600">
                      Staged
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">Date</span>
                      <p className="font-semibold">{record.timestamp || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty</span>
                      <p className="font-semibold">{record.quantity || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Location</span>
                      <p className="font-semibold text-xs">{record.location || '-'}</p>
                    </div>
                  </div>
                  {/* Photo thumbnails */}
                  {record.photos.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto">
                      {record.photos.map((photo, idx) => (
                        <button
                          key={idx}
                          onClick={() => setModalImage(photo)}
                          className="flex-shrink-0 w-16 h-16 rounded-md bg-muted overflow-hidden hover:opacity-80 transition-opacity"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo}
                            alt={`Staged photo ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          }}
        />
      )}

      {/* Image Modal */}
      <ImageModal
        src={modalImage || ''}
        isOpen={!!modalImage}
        onClose={() => setModalImage(null)}
        alt="Staged photo"
      />
    </div>
  )
}
