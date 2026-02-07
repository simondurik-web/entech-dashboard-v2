'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import type { Order } from '@/lib/google-sheets'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech' },
  { key: 'molding', label: 'Molding' },
  { key: 'snappad', label: 'Snap Pad' },
] as const

const DATE_FILTERS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All Time', days: null },
] as const

type CategoryFilterKey = (typeof CATEGORY_FILTERS)[number]['key']
type DateFilterKey = (typeof DATE_FILTERS)[number]['key']

interface StagedRecord {
  dateStaged: string
  partNumber: string
  customer: string
  qty: number
  location: string
  category: string
  stagedDateValue: Date | null
}

type StagedRecordRow = StagedRecord & Record<string, unknown>

const COLUMNS: ColumnDef<StagedRecordRow>[] = [
  { key: 'dateStaged', label: 'Date Staged', sortable: true, filterable: true },
  { key: 'partNumber', label: 'Part Number', sortable: true, filterable: true },
  { key: 'customer', label: 'Customer', sortable: true, filterable: true },
  {
    key: 'qty',
    label: 'Qty',
    sortable: true,
    render: (v) => (v as number).toLocaleString(),
  },
  { key: 'location', label: 'Location', sortable: true, filterable: true },
  { key: 'category', label: 'Category', sortable: true, filterable: true },
]

function parseDate(value: string): Date | null {
  if (!value) return null

  const mdY = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdY) {
    const month = Number(mdY[1])
    const day = Number(mdY[2])
    const year = Number(mdY[3])
    const parsed = new Date(year, month - 1, day)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isStaged(status: string): boolean {
  return status.toLowerCase().includes('staged')
}

function filterByCategory(records: StagedRecord[], filter: CategoryFilterKey): StagedRecord[] {
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

function filterByDate(records: StagedRecord[], filter: DateFilterKey): StagedRecord[] {
  const selected = DATE_FILTERS.find((f) => f.key === filter)
  if (!selected || selected.days === null) return records

  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - selected.days)

  return records.filter((r) => {
    if (!r.stagedDateValue) return false
    return r.stagedDateValue >= cutoff
  })
}

function toStagedRecord(order: Order): StagedRecord {
  const dateStaged = order.requestedDate || '-'
  return {
    dateStaged,
    partNumber: order.partNumber,
    customer: order.customer,
    qty: order.orderQty,
    location: order.line,
    category: order.category,
    stagedDateValue: parseDate(order.requestedDate),
  }
}

export default function StagedRecordsPage() {
  const [records, setRecords] = useState<StagedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilterKey>('all')
  const [dateFilter, setDateFilter] = useState<DateFilterKey>('all')

  useEffect(() => {
    fetch('/api/sheets')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch staged records')
        return res.json()
      })
      .then((data: Order[]) => {
        const stagedRecords = data
          .filter((order) => isStaged(order.internalStatus))
          .map(toStagedRecord)
        setRecords(stagedRecords)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const byCategory = filterByCategory(records, categoryFilter)
    return filterByDate(byCategory, dateFilter)
  }, [records, categoryFilter, dateFilter])

  const filteredRows = filtered as StagedRecordRow[]

  const table = useDataTable({
    data: filteredRows,
    columns: COLUMNS,
    storageKey: 'staged-records',
  })

  const totalStaged = filtered.length
  const totalUnits = filtered.reduce((sum, row) => sum + row.qty, 0)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📦 Staged Records</h1>
      <p className="text-muted-foreground text-sm mb-4">
        Date Staged uses requested date as a placeholder.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total staged</p>
          <p className="text-xl font-bold">{totalStaged.toLocaleString()}</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-600">Total units</p>
          <p className="text-xl font-bold text-blue-600">{totalUnits.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
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
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
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

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <DataTable
          table={table}
          data={filteredRows}
          noun="record"
          exportFilename="staged-records.csv"
          cardClassName={() => 'border-l-4 border-l-blue-500'}
          renderCard={(row, i) => {
            const record = row as unknown as StagedRecord
            return (
              <Card key={`${record.partNumber}-${i}`} className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">📦 {record.partNumber || '-'}</CardTitle>
                      <p className="text-sm text-muted-foreground">{record.customer || '-'}</p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-blue-500/15 text-blue-700">
                      Staged
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Date Staged</span>
                      <p className="font-semibold">{record.dateStaged || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Qty</span>
                      <p className="font-semibold">{record.qty.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Location</span>
                      <p className="font-semibold">{record.location || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Category</span>
                      <p className="font-semibold">{record.category || '-'}</p>
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
