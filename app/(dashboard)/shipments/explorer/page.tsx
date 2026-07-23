'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Home,
  PackageSearch,
  Search,
  X,
} from 'lucide-react'
import { authHeaders } from '@/lib/session-token'
import { todayET } from '@/lib/shipments/et-date'
import type { ShipmentFacets, ShipmentRow } from '@/lib/shipments/types'
import { useI18n } from '@/lib/i18n'
import { toast } from '@/lib/use-toast'

interface ExplorerResponse {
  rows: ShipmentRow[]
  count: number
  facets: ShipmentFacets
}

type ResidentialFilter = 'all' | 'true' | 'false'
type ExportFormat = 'xlsx' | 'pdf'

const PAGE_SIZE = 50
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
  const today = useMemo(() => todayET(), [])
  const [searchInput, setSearchInput] = useState('')
  const [partInput, setPartInput] = useState('')
  const [search, setSearch] = useState('')
  const [part, setPart] = useState('')
  const [source, setSource] = useState('')
  const [service, setService] = useState('')
  const [residential, setResidential] = useState<ResidentialFilter>('all')
  const [ltlOnly, setLtlOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<ShipmentRow[]>([])
  const [count, setCount] = useState(0)
  const [facets, setFacets] = useState<ShipmentFacets>({ sources: [], services: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPart(partInput.trim())
      setPage(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput, partInput])

  const filterParams = useCallback(() => {
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (part) params.set('part', part)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (source) params.set('source', source)
    if (service) params.set('service', service)
    if (residential !== 'all') params.set('residential', residential)
    if (ltlOnly) params.set('ltl', '1')
    return params
  }, [from, ltlOnly, part, residential, search, service, source, to])

  useEffect(() => {
    const controller = new AbortController()

    async function loadRows() {
      setLoading(true)
      setError(false)
      try {
        const params = filterParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        const response = await fetch(`/api/shipments/explorer?${params}`, {
          headers: authHeaders(),
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Request failed: ${response.status}`)
        const result = (await response.json()) as ExplorerResponse
        setRows(result.rows)
        setCount(result.count)
        setFacets(result.facets)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') setError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadRows()
    return () => controller.abort()
  }, [filterParams, page])

  const setFilter = (update: () => void) => {
    update()
    setPage(0)
  }

  const clearFilters = () => {
    setSearchInput('')
    setPartInput('')
    setSearch('')
    setPart('')
    setSource('')
    setService('')
    setResidential('all')
    setLtlOnly(false)
    setFrom('')
    setTo('')
    setPage(0)
  }

  const hasFilters = Boolean(
    searchInput || partInput || source || service || residential !== 'all' || ltlOnly || from || to
  )
  const firstRow = count === 0 ? 0 : page * PAGE_SIZE + 1
  const lastRow = Math.min((page + 1) * PAGE_SIZE, count)
  const hasNextPage = lastRow < count

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

  const trackingDisplay = (row: ShipmentRow) => {
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
  }

  const residentialDisplay = (value: boolean | null) => {
    if (value === null) return <span>{EMPTY_VALUE}</span>
    const label = value ? t('shipments.residential') : t('shipments.commercial')
    return value ? (
      <Home className="size-4" aria-label={label} />
    ) : (
      <Building2 className="size-4" aria-label={label} />
    )
  }

  return (
    <div className="p-4 pb-20 md:p-6">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <PackageSearch className="size-6 text-primary" />
          <h1 className="text-2xl font-bold">{t('shipments.explorerTitle')}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('shipments.explorerSubtitle')}
        </p>
      </div>

      <section className="mb-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative md:col-span-2">
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
          <label>
            <span className="sr-only">{t('shipments.productSearch')}</span>
            <input
              type="search"
              value={partInput}
              onChange={(event) => setPartInput(event.target.value)}
              placeholder={t('shipments.productSearchPlaceholder')}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
            />
          </label>
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
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.source')}</span>
            <select
              value={source}
              onChange={(event) => setFilter(() => setSource(event.target.value))}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">{t('shipments.allSources')}</option>
              {facets.sources.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.service')}</span>
            <select
              value={service}
              onChange={(event) => setFilter(() => setService(event.target.value))}
              disabled={ltlOnly}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              <option value="">{t('shipments.allServices')}</option>
              {facets.services.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.destinationType')}</span>
            <select
              value={residential}
              onChange={(event) =>
                setFilter(() => setResidential(event.target.value as ResidentialFilter))
              }
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="all">{t('shipments.allDestinations')}</option>
              <option value="true">{t('shipments.residential')}</option>
              <option value="false">{t('shipments.commercial')}</option>
            </select>
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.from')}</span>
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={(event) => setFilter(() => setFrom(event.target.value))}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.to')}</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(event) => setFilter(() => setTo(event.target.value))}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() =>
                setFilter(() => {
                  setLtlOnly((current) => !current)
                  setService('')
                })
              }
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                ltlOnly
                  ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              {t('shipments.ltlOnly')}
            </button>
            {hasFilters && (
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
        <>
          <div className="space-y-3 sm:hidden">
            {rows.map((row) => (
              <article
                key={row.id}
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
                    <p className="truncate font-medium">{destination(row) || EMPTY_VALUE}</p>
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
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border bg-card shadow-sm sm:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left">
                    <th className="px-3 py-3 font-medium">{t('shipments.sentAt')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.poNumber')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.partner')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.partNumber')}</th>
                    <th className="px-3 py-3 text-right font-medium">{t('shipments.quantity')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.recipient')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.destination')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.service')}</th>
                    <th className="px-3 py-3 text-center font-medium">{t('shipments.destinationType')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.source')}</th>
                    <th className="px-3 py-3 font-medium">{t('shipments.tracking')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b align-top last:border-0 hover:bg-muted/20">
                      <td className="whitespace-nowrap px-3 py-3">{formatEtTimestamp(row.sent_at)}</td>
                      <td className="max-w-36 truncate px-3 py-3 font-medium">{row.po_number || EMPTY_VALUE}</td>
                      <td className="max-w-40 truncate px-3 py-3">{row.partner || EMPTY_VALUE}</td>
                      <td className="max-w-40 truncate px-3 py-3 font-medium">{row.part_number || EMPTY_VALUE}</td>
                      <td className="px-3 py-3 text-right">{Number(row.qty).toLocaleString()}</td>
                      <td className="max-w-48 truncate px-3 py-3">{row.ship_to_name || EMPTY_VALUE}</td>
                      <td className="max-w-52 truncate px-3 py-3">{destination(row) || EMPTY_VALUE}</td>
                      <td className="max-w-48 px-3 py-3">
                        <span>{row.service || EMPTY_VALUE}</span>
                        {isLtl(row) && (
                          <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            {t('shipments.ltl')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="inline-flex">{residentialDisplay(row.residential)}</span>
                      </td>
                      <td className="max-w-48 truncate px-3 py-3">{row.source_system || EMPTY_VALUE}</td>
                      <td className="max-w-48 truncate px-3 py-3">{trackingDisplay(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {firstRow.toLocaleString()}–{lastRow.toLocaleString()} {t('shipments.of')}{' '}
              {count.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0}
                className="inline-flex items-center gap-1 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
                {t('shipments.previous')}
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => current + 1)}
                disabled={!hasNextPage}
                className="inline-flex items-center gap-1 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
              >
                {t('shipments.next')}
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
