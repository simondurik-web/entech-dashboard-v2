'use client'

import { Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { AutoRefreshControl } from '@/components/ui/AutoRefreshControl'
import { useAutoRefresh } from '@/lib/use-auto-refresh'
import { Search } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import type { ShippingRecord } from '@/lib/google-sheets-shared'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech' },
  { key: 'molding', label: 'Molding' },
  { key: 'snappad', label: 'Snap Pad' },
] as const

const ORDER_TYPE_FILTERS = [
  { key: 'all', label: 'All Orders' },
  { key: 'if', label: 'IF Orders' },
  { key: 'b2b', label: 'B2B / Veeqo' },
] as const

const PHOTO_TYPE_FILTERS = [
  { key: 'all', label: 'All Photos' },
  { key: 'shipment', label: '🚚 Shipment' },
  { key: 'paperwork', label: '📄 Paperwork' },
  { key: 'closeup', label: '🔍 Close-up' },
] as const

type CategoryKey = (typeof CATEGORY_FILTERS)[number]['key']
type OrderTypeKey = (typeof ORDER_TYPE_FILTERS)[number]['key']
type PhotoTypeKey = (typeof PHOTO_TYPE_FILTERS)[number]['key']

type ShippingRow = ShippingRecord & { _parsed: Date | null; _allPhotos: string[] } & Record<string, unknown>

function parseGSheetsDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const m = dateStr.match(/^Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$/)
  if (m) return new Date(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6])
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

function formatDate(d: Date | null): string {
  if (!d) return '-'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function toDateInputValue(d: Date): string { return d.toISOString().slice(0, 10) }

function getAllPhotos(r: ShippingRecord, filter: PhotoTypeKey): string[] {
  if (filter === 'shipment') return r.shipmentPhotos || []
  if (filter === 'paperwork') return r.paperworkPhotos || []
  if (filter === 'closeup') return r.closeUpPhotos || []
  // all: combine everything
  return [
    ...(r.photos || []),
    ...(r.shipmentPhotos || []),
    ...(r.paperworkPhotos || []),
    ...(r.closeUpPhotos || []),
  ]
}

export default function ShippingRecordsPage() {
  return <Suspense><ShippingRecordsPageContent /></Suspense>
}

function ShippingRecordsPageContent() {
  const [records, setRecords] = useState<ShippingRow[]>([])
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<CategoryKey>('all')
  const [orderTypeFilter, setOrderTypeFilter] = useState<OrderTypeKey>('all')
  const [photoTypeFilter, setPhotoTypeFilter] = useState<PhotoTypeKey>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const { t } = useI18n()

  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return toDateInputValue(d)
  })
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()))

  const setPreset = (days: number | 'all') => {
    if (days === 'all') { setStartDate(''); setEndDate('') }
    else {
      const end = new Date(); const start = new Date(); start.setDate(start.getDate() - days)
      setStartDate(toDateInputValue(start)); setEndDate(toDateInputValue(end))
    }
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/shipping-records')
      if (!res.ok) throw new Error('Failed to fetch shipping records')
      const data: ShippingRecord[] = await res.json()
      const parsed: ShippingRow[] = data.map(r => ({
        ...r,
        _parsed: parseGSheetsDate(r.shipDate || r.timestamp),
        _allPhotos: getAllPhotos(r, 'all'),
      }))
      parsed.sort((a, b) => (b._parsed?.getTime() ?? 0) - (a._parsed?.getTime() ?? 0))
      setRecords(parsed)
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch') }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  const autoRefresh = useAutoRefresh({ interval: 5 * 60 * 1000, onRefresh: () => fetchData(true) })

  const filtered = useMemo(() => {
    let result = records
    if (startDate) { const s = new Date(startDate + 'T00:00:00'); result = result.filter(r => r._parsed && r._parsed >= s) }
    if (endDate) { const e = new Date(endDate + 'T23:59:59'); result = result.filter(r => r._parsed && r._parsed <= e) }
    if (categoryFilter !== 'all') {
      result = result.filter(r => {
        const cat = r.category.toLowerCase()
        switch (categoryFilter) {
          case 'rolltech': return cat.includes('roll')
          case 'molding': return cat.includes('molding')
          case 'snappad': return cat.includes('snap')
          default: return true
        }
      })
    }
    if (orderTypeFilter !== 'all') {
      result = result.filter(r => {
        const ifUpper = r.ifNumber.toUpperCase()
        return orderTypeFilter === 'if' ? ifUpper.startsWith('IF') : ifUpper.startsWith('B2B')
      })
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(r =>
        r.ifNumber.toLowerCase().includes(q) ||
        r.customer.toLowerCase().includes(q) ||
        r.carrier?.toLowerCase().includes(q) ||
        r.bol?.toLowerCase().includes(q)
      )
    }
    return result
  }, [records, startDate, endDate, categoryFilter, orderTypeFilter, searchQuery])

  const COLUMNS: ColumnDef<ShippingRow>[] = useMemo(() => [
    { key: 'timestamp', label: 'Date', sortable: true, render: (_v, row) => formatDate((row as ShippingRow)._parsed) },
    { key: 'customer', label: 'Customer', sortable: true, filterable: true },
    { key: 'ifNumber', label: 'IF#', sortable: true },
    { key: 'category', label: 'Category', sortable: true, filterable: true },
    { key: 'carrier', label: 'Carrier', sortable: true, filterable: true },
    { key: 'bol', label: 'BOL#', sortable: true },
    { key: 'palletCount', label: 'Pallets', sortable: true },
    {
      key: '_allPhotos' as keyof ShippingRow & string, label: 'Photos',
      render: (_v, row) => {
        const r = row as ShippingRow
        const photos = getAllPhotos(r, photoTypeFilter)
        return <PhotoGrid photos={photos} size="sm" maxVisible={3} context={{ ifNumber: r.ifNumber }} />
      },
    },
  ], [photoTypeFilter])

  const table = useDataTable({ data: filtered, columns: COLUMNS, storageKey: 'shipping-records' })

  const totalShipments = filtered.length
  const totalPallets = filtered.reduce((sum, r) => sum + r.palletCount, 0)
  const totalPhotos = filtered.reduce((sum, r) => sum + getAllPhotos(r, photoTypeFilter).length, 0)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">🚛 {t('page.shippingRecords')}</h1>
        <AutoRefreshControl
          isEnabled={autoRefresh.isAutoRefreshEnabled}
          onToggle={autoRefresh.toggleAutoRefresh}
          onRefreshNow={() => fetchData(true)}
          isRefreshing={refreshing}
          nextRefresh={autoRefresh.nextRefresh}
          lastRefresh={autoRefresh.lastRefresh}
        />
      </div>
      <p className="text-muted-foreground text-sm mb-4">{t('page.shippingRecordsSubtitle')}</p>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input type="text" placeholder={t('shippingRecords.searchPlaceholder')}
          value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-muted rounded-lg text-sm outline-none placeholder:text-muted-foreground/60" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">{t('shippingRecords.shipments')}</p>
          <p className="text-xl font-bold text-green-600">{totalShipments}</p>
        </div>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">{t('table.pallets')}</p>
          <p className="text-xl font-bold">{totalPallets}</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-600">{t('table.photos')}</p>
          <p className="text-xl font-bold text-blue-600">{totalPhotos}</p>
        </div>
      </div>

      {/* Date Range */}
      <div className="mb-3">
        <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
          {[
            { label: t('palletRecords.7days'), days: 7 },
            { label: t('palletRecords.30days'), days: 30 },
            { label: t('palletRecords.90days'), days: 90 },
            { label: t('ui.allTime'), days: 'all' as const },
          ].map(p => (
            <button key={p.label} onClick={() => setPreset(p.days)}
              className="px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors bg-muted hover:bg-muted/80">
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="bg-muted rounded-lg px-3 py-1.5 text-sm border-none outline-none" />
          <span className="text-muted-foreground text-sm">to</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="bg-muted rounded-lg px-3 py-1.5 text-sm border-none outline-none" />
        </div>
      </div>

      {/* Order type + Photo type filters */}
      <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
        {ORDER_TYPE_FILTERS.map(f => (
          <button key={f.key} onClick={() => setOrderTypeFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              orderTypeFilter === f.key ? 'bg-blue-600 text-white' : 'bg-muted hover:bg-muted/80'}`}>
            {f.key === 'all' ? t('palletRecords.allOrders') : f.key === 'if' ? t('palletRecords.ifOrders') : t('palletRecords.b2bOrders')}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
        {PHOTO_TYPE_FILTERS.map(f => (
          <button key={f.key} onClick={() => setPhotoTypeFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              photoTypeFilter === f.key ? 'bg-purple-600 text-white' : 'bg-muted hover:bg-muted/80'}`}>
            {f.key === 'all' ? t('shippingRecords.allPhotos') : f.key === 'shipment' ? '🚚 ' + t('shippingRecords.shipment') : f.key === 'paperwork' ? '📄 ' + t('shippingRecords.paperwork') : '🔍 ' + t('shippingRecords.closeup')}
          </button>
        ))}
      </div>

      {/* Category filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {CATEGORY_FILTERS.map(f => (
          <button key={f.key} onClick={() => setCategoryFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              categoryFilter === f.key ? 'bg-green-600 text-white' : 'bg-muted hover:bg-muted/80'}`}>
            {f.key === 'all' ? t('category.all') : f.key === 'rolltech' ? t('category.rollTech') : f.key === 'molding' ? t('category.molding') : t('category.snappad')}
          </button>
        ))}
      </div>

      {loading && (
        <TableSkeleton rows={8} />
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <DataTable table={table} data={filtered} noun="shipment" exportFilename="shipping-records.csv"
          page="shipping-records"
          initialView={initialView}
          autoExport={autoExport}
          cardClassName={() => 'border-l-4 border-l-green-500'}
          renderCard={(row, i) => {
            const record = row as unknown as ShippingRow
            const isB2B = record.ifNumber.toUpperCase().startsWith('B2B')
            const photos = getAllPhotos(record, photoTypeFilter)
            return (
              <Card key={`${record.ifNumber}-${i}`} className={`border-l-4 ${isB2B ? 'border-l-blue-500' : 'border-l-green-500'}`}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">{record.customer || 'Unknown'}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {isB2B && <span className="text-blue-500 font-medium">B2B </span>}
                        IF# {record.ifNumber} • {record.carrier || 'Unknown carrier'}
                      </p>
                    </div>
                    <span className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-600">{t('status.shipped')}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                    <div>
                      <span className="text-muted-foreground">{t('shippingRecords.shipDate')}</span>
                      <p className="font-semibold">{formatDate(record._parsed)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('table.bol')}</span>
                      <p className="font-semibold text-xs">{record.bol || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('table.pallets')}</span>
                      <p className="font-semibold">{record.palletCount || '-'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <span className="bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full">
                      {record.category || 'Uncategorized'}
                    </span>
                  </div>
                  <PhotoGrid photos={photos} size="md" context={{ ifNumber: record.ifNumber }} />
                </CardContent>
              </Card>
            )
          }}
        />
      )}
    </div>
  )
}
