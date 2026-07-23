'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Home,
  PackageSearch,
  Search,
  X,
} from 'lucide-react'
import { DataTable } from '@/components/data-table'
import { authHeaders } from '@/lib/session-token'
import { todayET } from '@/lib/shipments/et-date'
import { SPS_PORTAL_URL } from '@/lib/shipments/product-colors'
import type { ShipmentRow } from '@/lib/shipments/types'
import { useI18n } from '@/lib/i18n'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useAutoExport, useViewFromUrl } from '@/lib/use-view-from-url'
import { toast } from '@/lib/use-toast'

type ExplorerRow = ShipmentRow & {
  destination: string
  destinationType: string
  sentAtMs: number
} & Record<string, unknown>

interface ExplorerResponse {
  rows: ShipmentRow[]
  count: number
  truncated: boolean
}

type ExportFormat = 'xlsx' | 'pdf'

const XLSX_CAP = 50_000
const PDF_CAP = 2_000
const EMPTY_VALUE = '—'

function formatEtTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${value('month')}/${value('day')} ${value('hour')}:${value('minute')}`
}

function destination(row: ShipmentRow): string {
  return [row.city, row.state, row.zip].filter(Boolean).join(' ')
}

function isLtl(row: ShipmentRow): boolean {
  return row.service === 'LTL (set-aside)'
}

function downloadFilename(disposition: string | null, format: ExportFormat): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? `shipments.${format}`
}

export default function ShipmentsExplorerPage() {
  return (
    <Suspense>
      <ShipmentsExplorerContent />
    </Suspense>
  )
}

function ShipmentsExplorerContent() {
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()
  const today = useMemo(() => todayET(), [])
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [ltlOnly, setLtlOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<ExplorerRow[]>([])
  const [count, setCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const residentialLabel = t('shipments.residential')
  const commercialLabel = t('shipments.commercial')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const filterParams = useCallback(() => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (ltlOnly) params.set('ltl', '1')
    return params
  }, [from, ltlOnly, search, to])

  useEffect(() => {
    const controller = new AbortController()

    async function loadRows() {
      setLoading(true)
      setError(false)
      try {
        const params = filterParams()
        params.set('all', '1')
        const response = await fetch(`/api/shipments/explorer?${params}`, {
          headers: authHeaders(),
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Request failed: ${response.status}`)
        const result = (await response.json()) as ExplorerResponse
        setRows(result.rows.map((row) => {
          const sentAtMs = new Date(row.sent_at).getTime()
          return {
            ...row,
            destination: destination(row),
            destinationType:
              row.residential === null
                ? EMPTY_VALUE
                : row.residential
                  ? residentialLabel
                  : commercialLabel,
            sentAtMs: Number.isNaN(sentAtMs) ? 0 : sentAtMs,
          }
        }))
        setCount(result.count)
        setTruncated(result.truncated)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadRows()
    return () => controller.abort()
  }, [commercialLabel, filterParams, residentialLabel])

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setLtlOnly(false)
    setFrom('')
    setTo('')
  }

  const hasServerFilters = Boolean(searchInput || ltlOnly || from || to)

  const exportRows = async (format: ExportFormat) => {
    setExporting(format)
    try {
      const params = filterParams()
      params.set('format', format)
      const response = await fetch(`/api/shipments/export?${params}`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = downloadFilename(response.headers.get('Content-Disposition'), format)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast({ title: t('shipments.exportReady'), type: 'success' })
    } catch {
      toast({ title: t('shipments.exportFailed'), type: 'error' })
    } finally {
      setExporting(null)
    }
  }

  const trackingDisplay = useCallback((row: ExplorerRow) => {
    if (isLtl(row) || !row.tracking) return <span>{EMPTY_VALUE}</span>
    const isFedEx = row.service?.toLowerCase().includes('fedex') ?? false
    if (!isFedEx) return <span className="font-mono text-xs">{row.tracking}</span>
    return (
      <a
        href={`https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(row.tracking)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-xs text-primary hover:underline"
        aria-label={`${t('shipments.trackPackage')} ${row.tracking}`}
      >
        {row.tracking}
      </a>
    )
  }, [t])

  const residentialDisplay = useCallback((value: boolean | null) => {
    if (value === null) return <span>{EMPTY_VALUE}</span>
    const label = value ? t('shipments.residential') : t('shipments.commercial')
    return value ? (
      <Home className="size-4" aria-label={label} />
    ) : (
      <Building2 className="size-4" aria-label={label} />
    )
  }, [t])

  const columns = useMemo<ColumnDef<ExplorerRow>[]>(() => [
    {
      key: 'sent_at',
      label: t('shipments.sentAt'),
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="whitespace-nowrap">{formatEtTimestamp(String(value))}</span>
      ),
    },
    {
      key: 'po_number',
      label: t('shipments.poNumber'),
      sortable: true,
      filterable: true,
    },
    {
      key: 'partner',
      label: t('shipments.partner'),
      sortable: true,
      filterable: true,
    },
    {
      key: 'part_number',
      label: t('shipments.partNumber'),
      sortable: true,
      filterable: true,
    },
    {
      key: 'qty',
      label: t('shipments.quantity'),
      sortable: true,
      filterable: false,
      render: (value) => (
        <span className="block text-right">{Number(value).toLocaleString()}</span>
      ),
    },
    {
      key: 'ship_to_name',
      label: t('shipments.recipient'),
      sortable: true,
      filterable: false,
    },
    {
      key: 'destination',
      label: t('shipments.destination'),
      sortable: true,
      filterable: false,
      render: (value) => String(value || EMPTY_VALUE),
    },
    {
      key: 'service',
      label: t('shipments.service'),
      sortable: true,
      filterable: true,
      render: (value, row) => (
        <span className="whitespace-nowrap">
          {String(value || EMPTY_VALUE)}
          {isLtl(row) && (
            <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
              {t('shipments.ltl')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'destinationType',
      label: t('shipments.destinationType'),
      sortable: false,
      filterable: true,
      render: (_value, row) => (
        <span className="inline-flex">{residentialDisplay(row.residential)}</span>
      ),
    },
    {
      key: 'source_system',
      label: t('shipments.source'),
      sortable: true,
      filterable: true,
    },
    {
      key: 'tracking',
      label: t('shipments.tracking'),
      sortable: false,
      filterable: false,
      render: (_value, row) => trackingDisplay(row),
    },
  ], [residentialDisplay, t, trackingDisplay])

  // Supabase returns normalized ISO timestamps, so sorting the raw sent_at key
  // is chronological and keeps built-in CSV/Excel exports meaningful. sentAtMs
  // is still precomputed on every loaded row for consumers that need a number.
  const table = useDataTable({
    data: rows,
    columns,
    storageKey: 'shipments-explorer',
  })

  return (
    <div className="p-4 pb-20 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PackageSearch className="size-6 text-primary" />
            <h1 className="text-2xl font-bold">{t('shipments.explorerTitle')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('shipments.explorerSubtitle')}
          </p>
        </div>
        <a
          href={SPS_PORTAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
        >
          <ExternalLink className="size-4" />
          {t('shipments.spsPortal')}
        </a>
      </div>

      <section className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <label className="relative">
            <span className="sr-only">{t('shipments.addressSearch')}</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('shipments.addressSearchPlaceholder')}
              className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </label>

          <div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void exportRows('xlsx')}
                disabled={exporting !== null}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                <FileSpreadsheet className="size-4" />
                {exporting === 'xlsx' ? t('shipments.exporting') : t('shipments.excel')}
              </button>
              <button
                type="button"
                onClick={() => void exportRows('pdf')}
                disabled={exporting !== null}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                <FileText className="size-4" />
                {exporting === 'pdf' ? t('shipments.exporting') : t('shipments.pdf')}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('shipments.fullRangeExportCaption')}
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.from')}</span>
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.to')}</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(event) => setTo(event.target.value)}
              className="w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setLtlOnly((current) => !current)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                ltlOnly
                  ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              {t('shipments.ltlOnly')}
            </button>
            {hasServerFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border bg-background p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('shipments.clearFilters')}
                title={t('shipments.clearFilters')}
              >
                <X className="size-5" />
              </button>
            )}
          </div>
        </div>

        {count > XLSX_CAP && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            {t('shipments.xlsxLimitWarning')}
          </p>
        )}
        {count > PDF_CAP && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {t('shipments.pdfLimitWarning')}
          </p>
        )}
      </section>

      {!loading && !error && truncated && (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {t('shipments.truncatedWarning')}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
          {t('shipments.loadError')}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          {t('shipments.noMatchingShipments')}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <DataTable
          table={table}
          data={rows}
          noun={t('shipments.shipmentNoun')}
          exportFilename="shipments"
          page="shipments-explorer"
          pageSize={50}
          initialView={initialView}
          autoExport={autoExport}
          getRowKey={(row) => row.id}
          renderCard={(row) => (
            <article
              className={`rounded-xl border-l-4 bg-card p-4 shadow-sm ${
                isLtl(row) ? 'border-l-amber-500' : 'border-l-primary'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{row.ship_to_name || EMPTY_VALUE}</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatEtTimestamp(row.sent_at)}
                  </p>
                </div>
                {isLtl(row) && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                    {t('shipments.ltl')}
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                <div>
                  <p className="text-muted-foreground">{t('shipments.poNumber')}</p>
                  <p className="truncate font-medium">{row.po_number || EMPTY_VALUE}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.partner')}</p>
                  <p className="truncate font-medium">{row.partner || EMPTY_VALUE}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.partNumber')}</p>
                  <p className="truncate font-medium">{row.part_number || EMPTY_VALUE}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.quantity')}</p>
                  <p className="font-medium">{Number(row.qty).toLocaleString()}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">{t('shipments.destination')}</p>
                  <p className="truncate font-medium">{row.destination || EMPTY_VALUE}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.service')}</p>
                  <p className="truncate font-medium">{row.service || EMPTY_VALUE}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.destinationType')}</p>
                  <div className="mt-0.5">{residentialDisplay(row.residential)}</div>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.source')}</p>
                  <p className="truncate font-medium">{row.source_system || EMPTY_VALUE}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t('shipments.tracking')}</p>
                  <div className="truncate font-medium">{trackingDisplay(row)}</div>
                </div>
              </div>
            </article>
          )}
        />
      )}
    </div>
  )
}
