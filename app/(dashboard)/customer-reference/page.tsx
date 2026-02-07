'use client'

import { useEffect, useState } from 'react'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'

type CustomerRecord = Record<string, unknown>

export default function CustomerReferencePage() {
  const [data, setData] = useState<CustomerRecord[]>([])
  const [columns, setColumns] = useState<ColumnDef<CustomerRecord>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/generic-sheet?gid=customerReference')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch Customer Reference data')
        return res.json()
      })
      .then(({ headers, data }: { headers: string[]; data: CustomerRecord[] }) => {
        // Build columns from headers
        const cols: ColumnDef<CustomerRecord>[] = headers.map((h) => ({
          key: h,
          label: h,
          sortable: true,
          filterable: true,
        }))
        setColumns(cols)
        setData(data)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const table = useDataTable({
    data,
    columns,
    storageKey: 'customer-reference',
  })

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">👥 Customer Reference</h1>
      <p className="text-muted-foreground text-sm mb-4">
        Customer information and contacts
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-purple-500/10 rounded-lg p-3">
          <p className="text-xs text-purple-600">Total Customers</p>
          <p className="text-xl font-bold text-purple-600">{data.length}</p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Fields</p>
          <p className="text-xl font-bold">{columns.length}</p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && columns.length > 0 && (
        <DataTable
          table={table}
          data={data}
          noun="customer"
          exportFilename="customer-reference.csv"
        />
      )}
    </div>
  )
}
