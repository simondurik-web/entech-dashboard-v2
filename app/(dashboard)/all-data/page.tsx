'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, Database, Search, Download, Columns, ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
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
  const [search, setSearch] = useState('')
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set())
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const { t } = useI18n()

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/all-data')
      if (!res.ok) throw new Error('Failed to fetch data')
      const data = await res.json()
      setResponse(data)
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

  // Get visible columns
  const visibleColumns = useMemo(() => {
    if (!response) return []
    return response.columns.filter((col) => !hiddenColumns.has(col))
  }, [response, hiddenColumns])

  // Filter and sort data
  const filteredData = useMemo(() => {
    if (!response) return []
    
    let data = response.data
    
    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase()
      data = data.filter((row) =>
        Object.values(row).some((val) =>
          val.toLowerCase().includes(searchLower)
        )
      )
    }
    
    // Sort
    if (sortColumn) {
      data = [...data].sort((a, b) => {
        const aVal = a[sortColumn] || ''
        const bVal = b[sortColumn] || ''
        
        // Try numeric sort first
        const aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''))
        const bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''))
        
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
        }
        
        // String sort
        const cmp = aVal.localeCompare(bVal)
        return sortDirection === 'asc' ? cmp : -cmp
      })
    }
    
    return data
  }, [response, search, sortColumn, sortDirection])

  const toggleColumn = (col: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(col)) {
        next.delete(col)
      } else {
        next.add(col)
      }
      return next
    })
  }

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(col)
      setSortDirection('asc')
    }
  }

  const exportCSV = () => {
    if (!response) return
    
    const headers = visibleColumns.join(',')
    const rows = filteredData.map((row) =>
      visibleColumns.map((col) => {
        const val = row[col] || ''
        // Escape quotes and wrap in quotes if contains comma
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`
        }
        return val
      }).join(',')
    )
    
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'all-data.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Database className="size-6 text-primary" />
          <h1 className="text-2xl font-bold">{t('page.allData')}</h1>
        </div>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        {t('page.allDataSubtitle')}
      </p>

      {/* Stats */}
      {response && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{t('stats.totalRecords')}</p>
            <p className="text-xl font-bold">{response.data.length.toLocaleString()}</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{t('ui.columns')}</p>
            <p className="text-xl font-bold">{response.columns.length}</p>
          </div>
          <div className="bg-muted rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{t('allData.showing')}</p>
            <p className="text-xl font-bold">{filteredData.length.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t('ui.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        
        {/* Column Visibility */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Columns className="size-4" />
              {t('ui.columns')}
              <ChevronDown className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 max-h-80 overflow-auto p-2">
            <div className="flex justify-between items-center mb-2 pb-2 border-b">
              <span className="text-sm font-medium">{t('ui.columns')}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHiddenColumns(new Set())}
              >
                Show All
              </Button>
            </div>
            {response?.columns.map((col) => (
              <label
                key={col}
                className="flex items-center gap-2 py-1 px-2 hover:bg-muted rounded cursor-pointer"
              >
                <Checkbox
                  checked={!hiddenColumns.has(col)}
                  onCheckedChange={() => toggleColumn(col)}
                />
                <span className="text-sm truncate">{col}</span>
              </label>
            ))}
          </PopoverContent>
        </Popover>

        {/* Export */}
        <Button variant="outline" className="gap-2" onClick={exportCSV}>
          <Download className="size-4" />
          {t('ui.export')} CSV
        </Button>
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
      {!loading && !error && response && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                {visibleColumns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer hover:bg-muted/70 whitespace-nowrap"
                    onClick={() => handleSort(col)}
                  >
                    <div className="flex items-center gap-1">
                      {col}
                      {sortColumn === col && (
                        <span className="text-primary">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((row, i) => (
                <tr
                  key={i}
                  className="border-t hover:bg-muted/30 transition-colors"
                >
                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                  {visibleColumns.map((col) => (
                    <td key={col} className="px-3 py-2 max-w-[200px] truncate" title={row[col]}>
                      {row[col] || '-'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredData.length === 0 && (
            <div className="text-center py-10 text-muted-foreground">
              {t('ui.noData')}
            </div>
          )}
        </div>
      )}

      {/* Mobile hint (iPhone only) */}
      <div className="sm:hidden mt-4">
        <p className="text-xs text-muted-foreground text-center">
          💡 Scroll horizontally on the table above, or export CSV for full view
        </p>
      </div>
    </div>
  )
}
