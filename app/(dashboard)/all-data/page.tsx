'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'

interface AllDataResponse {
  columns: string[]
  data: Record<string, string>[]
}

export default function AllDataPage() {
  const [response, setResponse] = useState<AllDataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { t } = useI18n()

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/all-data')
      if (!res.ok) throw new Error('Failed to fetch data')
      const data = await res.json()
      // Handle both { columns, data } and plain array formats
      if (Array.isArray(data)) {
        const columns = data.length > 0 ? Object.keys(data[0]) : []
        setResponse({ columns, data })
      } else {
        setResponse(data)
      }
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

  // Generate column definitions from the response columns
  const columnDefs: ColumnDef<Record<string, unknown>>[] = useMemo(() => {
    if (!response?.columns) return []
    return response.columns.map((col) => ({
      key: col,
      label: col,
      sortable: true,
      filterable: true,
    }))
  }, [response?.columns])

  const tableData = useMemo(() => {
    return (response?.data || []) as Record<string, unknown>[]
  }, [response?.data])

  const table = useDataTable({
    data: tableData,
    columns: columnDefs,
    storageKey: 'all-data',
  })

  // Stats
  const totalRecords = response?.data?.length || 0
  const totalColumns = response?.columns?.length || 0
  const filteredCount = table.processedData.length

  if (loading) {
    return (
      <div className="p-4 pb-20">
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="size-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading all data...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 pb-20">
        <div className="text-center py-20">
          <p className="text-destructive mb-4">Error: {error}</p>
          <Button onClick={() => fetchData()}>Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">🗃 {t('page.allData')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('allData.subtitle') || 'Complete raw dataset — all orders, all statuses'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-card border rounded-xl p-3">
          <p className="text-xs text-muted-foreground">{t('allData.totalRecords') || 'Total Records'}</p>
          <p className="text-2xl font-bold">{totalRecords.toLocaleString()}</p>
        </div>
        <div className="bg-card border rounded-xl p-3">
          <p className="text-xs text-muted-foreground">{t('allData.columns') || 'Columns'}</p>
          <p className="text-2xl font-bold">{totalColumns}</p>
        </div>
        <div className="bg-card border rounded-xl p-3">
          <p className="text-xs text-muted-foreground">{t('allData.showing') || 'Showing'}</p>
          <p className="text-2xl font-bold">{filteredCount.toLocaleString()}</p>
        </div>
      </div>

      {/* DataTable with all features */}
      <DataTable
        table={table}
        data={tableData}
        noun={t('allData.noun') || 'record'}
        exportFilename="all-data"
          page="all-data"
        getRowKey={(row, i) => String((row as Record<string, unknown>)['Line'] || i)}
      />
    </div>
  )
}
