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
  { key: 'rolltech', label: 'Roll Tech' },
  { key: 'molding', label: 'Molding' },
  { key: 'snappad', label: 'Snap Pad' },
] as const

type DateKey = (typeof DATE_FILTERS)[number]['key']
type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']

interface PalletRecord {
  date: string
  partNumber: string
  palletId: string
  qty: number
  category: string
}

type PalletRecordRow = PalletRecord & Record<string, unknown>

const COLUMNS: ColumnDef<PalletRecordRow>[] = [
  { key: 'date', label: 'Date', sortable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'palletId', label: 'Pallet ID', sortable: true, filterable: true },
  { key: 'qty', label: 'Qty', sortable: true, render: (v) => (v as number).toLocaleString() },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
]

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [m, d, y] = parts.map(Number)
  if ([m, d, y].some(Number.isNaN)) return null
  return new Date(y, m - 1, d)
}

function filterByDate(records: PalletRecord[], days: DateKey): PalletRecord[] {
  if (days === 'all') return records
  const now = new Date()
  const cutoff = new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000)

  return records.filter((record) => {
    const date = parseDate(record.date)
    return date && date >= cutoff
  })
}

function filterByCategory(records: PalletRecord[], filter: CategoryKey): PalletRecord[] {
  switch (filter) {
    case 'rolltech':
      return records.filter((r) => r.category.toLowerCase().includes('roll'))
    case 'molding':
      return records.filter((r) => r.category.toLowerCase().includes('molding'))
    case 'snappad':
      return records.filter((r) => r.category.toLowerCase().includes('snap'))
    default:
      return records
  }
}

function toPalletRecord(order: Order): PalletRecord {
  return {
    date: order.dateOfRequest || order.requestedDate || '',
    partNumber: order.partNumber,
    palletId: order.ifNumber || order.poNumber || '-',
    qty: order.orderQty,
    category: order.category,
  }
}

export default function PalletRecordsPage() {
  const [records, setRecords] = useState<PalletRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<DateKey>('30')
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')

  useEffect(() => {
    fetch('/api/sheets')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch pallet records')
        return res.json()
      })
      .then((data: Order[]) => {
        // Placeholder: staged orders represent pallet staging records for now.
        const stagedRecords = data
          .filter((o) => o.internalStatus.toLowerCase().includes('staged'))
          .map(toPalletRecord)
          .sort((a, b) => {
            const dateA = parseDate(a.date)
            const dateB = parseDate(b.date)
            if (!dateA && !dateB) return 0
            if (!dateA) return 1
            if (!dateB) return -1
            return dateB.getTime() - dateA.getTime()
          })

        setRecords(stagedRecords)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterByCategory(filterByDate(records, dateFilter), categoryFilter) as PalletRecordRow[]

  const table = useDataTable({
    data: filtered,
    columns: COLUMNS,
    storageKey: 'pallet-records',
  })

  const totalPallets = filtered.length
  const totalUnits = filtered.reduce((sum, r) => sum + r.qty, 0)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">Pallet Records</h1>
      <p className="text-muted-foreground text-sm mb-4">Staged pallet activity</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Total Pallets</p>
          <p className="text-xl font-bold text-green-600">{totalPallets}</p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Units</p>
          <p className="text-xl font-bold">{totalUnits.toLocaleString()}</p>
        </div>
      </div>

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
          cardClassName={() => 'border-l-green-500'}
          renderCard={(row, i) => {
            const record = row as unknown as PalletRecord
            return (
              <Card key={`${record.palletId}-${i}`} className="border-l-4 border-l-green-500">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <CardTitle className="text-lg">{record.partNumber}</CardTitle>
                      <p className="text-sm text-muted-foreground">{record.category}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">
                      Staged
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Date</span>
                      <p className="font-semibold">{record.date || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pallet ID</span>
                      <p className="font-semibold">{record.palletId}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty</span>
                      <p className="font-semibold">{record.qty.toLocaleString()}</p>
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
