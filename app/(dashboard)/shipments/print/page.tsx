'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  LoaderCircle,
  Minus,
  Plus,
  Printer,
  XCircle,
} from 'lucide-react'
import { SPS_PORTAL_URL } from '@/lib/shipments/product-colors'
import { authHeaders } from '@/lib/session-token'
import { todayET } from '@/lib/shipments/et-date'
import type {
  DeliverableFile,
  DeliverableKind,
} from '@/lib/shipments/types'
import { useI18n } from '@/lib/i18n'
import { usePermissions } from '@/lib/use-permissions'
import { toast } from '@/lib/use-toast'

interface DeliverablesResponse {
  date: string
  files: DeliverableFile[]
}

interface PrintStation {
  id: string
  name: string
}

interface PrintJob {
  id: string
  station_id: string
  status: string
  error: string | null
  created_at: string
  printed_at: string | null
}

const LETTER_KINDS = new Set<DeliverableKind>(['packing-fedex', 'packing-ltl', 'summary'])
const FILE_ORDER: DeliverableKind[] = [
  'packing-fedex',
  'packing-ltl',
  'labels',
  'summary',
  'other',
]

function deliverableKey(kind: DeliverableKind): string {
  const keys: Record<DeliverableKind, string> = {
    'packing-fedex': 'shipments.filePackingFedex',
    'packing-ltl': 'shipments.filePackingLtl',
    labels: 'shipments.fileLabels',
    summary: 'shipments.fileRunSummary',
    other: 'shipments.fileOther',
  }
  return keys[kind]
}

function statusKey(status: string): string {
  // Station agents complete jobs as 'done' or 'error' (complete_print_job RPC).
  const keys: Record<string, string> = {
    pending: 'shipments.printStatusPending',
    claimed: 'shipments.printStatusClaimed',
    printing: 'shipments.printStatusPrinting',
    done: 'shipments.printStatusPrinted',
    printed: 'shipments.printStatusPrinted',
    complete: 'shipments.printStatusPrinted',
    failed: 'shipments.printStatusFailed',
    error: 'shipments.printStatusFailed',
  }
  return keys[status.toLowerCase()] ?? 'shipments.printStatusUnknown'
}

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

function JobStatusIcon({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  if (normalized === 'done' || normalized === 'printed' || normalized === 'complete') {
    return <CheckCircle2 className="size-4 text-emerald-500" />
  }
  if (normalized === 'failed' || normalized === 'error') {
    return <XCircle className="size-4 text-destructive" />
  }
  if (normalized === 'claimed' || normalized === 'printing') {
    return <LoaderCircle className="size-4 animate-spin text-blue-500" />
  }
  return <Clock3 className="size-4 text-amber-500" />
}

export default function ShipmentPrintPage() {
  return (
    <Suspense>
      <ShipmentPrintContent />
    </Suspense>
  )
}

function ShipmentPrintContent() {
  const { t } = useI18n()
  const { canAccessExact } = usePermissions()
  const canPrint = canAccessExact('shipments:print')
  const today = useMemo(() => todayET(), [])
  const [date, setDate] = useState(today)
  const [files, setFiles] = useState<DeliverableFile[]>([])
  const [stations, setStations] = useState<PrintStation[]>([])
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [stationByPath, setStationByPath] = useState<Record<string, string>>({})
  const [copiesByPath, setCopiesByPath] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [viewingPath, setViewingPath] = useState<string | null>(null)
  const [printingPath, setPrintingPath] = useState<string | null>(null)

  const loadDeliverables = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(false)
    try {
      const response = await fetch(`/api/shipments/deliverables?date=${date}`, {
        headers: authHeaders(),
        cache: 'no-store',
        signal,
      })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      const result = (await response.json()) as DeliverablesResponse
      setFiles(
        [...result.files].sort(
          (left, right) => FILE_ORDER.indexOf(left.kind) - FILE_ORDER.indexOf(right.kind)
        )
      )
    } catch (requestError) {
      if ((requestError as Error).name !== 'AbortError') setError(true)
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [date])

  useEffect(() => {
    const controller = new AbortController()
    setStationByPath({})
    setCopiesByPath({})
    void loadDeliverables(controller.signal)
    return () => controller.abort()
  }, [loadDeliverables])

  useEffect(() => {
    if (!canPrint) {
      setStations([])
      return
    }
    const controller = new AbortController()

    async function loadStations() {
      try {
        const response = await fetch('/api/shipments/print/stations', {
          headers: authHeaders(),
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Request failed: ${response.status}`)
        const result = (await response.json()) as { stations: PrintStation[] }
        setStations(result.stations)
      } catch (requestError) {
        if ((requestError as Error).name !== 'AbortError') {
          setStations([])
          toast({ title: t('shipments.printersLoadFailed'), type: 'error' })
        }
      }
    }

    void loadStations()
    return () => controller.abort()
  }, [canPrint, t])

  useEffect(() => {
    if (stations.length !== 1 || files.length === 0) return
    setStationByPath((current) => {
      const next = { ...current }
      for (const file of files) {
        if (LETTER_KINDS.has(file.kind) && !next[file.path]) {
          next[file.path] = stations[0].id
        }
      }
      return next
    })
  }, [files, stations])

  const loadStatus = useCallback(async () => {
    if (!canPrint) return
    try {
      const response = await fetch(`/api/shipments/print/status?date=${date}`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      const result = (await response.json()) as { jobs: PrintJob[] }
      setJobs(result.jobs)
    } catch {
      setJobs([])
    }
  }, [canPrint, date])

  useEffect(() => {
    if (!canPrint) {
      setJobs([])
      return
    }

    let interval: number | null = null
    const stop = () => {
      if (interval !== null) window.clearInterval(interval)
      interval = null
    }
    const start = () => {
      stop()
      if (document.visibilityState !== 'visible') return
      void loadStatus()
      interval = window.setInterval(() => void loadStatus(), 10_000)
    }
    const handleVisibility = () => start()

    start()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [canPrint, loadStatus])

  const viewFile = async (file: DeliverableFile) => {
    setViewingPath(file.path)
    const popup = window.open('', '_blank')
    if (popup) popup.opener = null

    try {
      const response = await fetch('/api/shipments/deliverables/sign', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        cache: 'no-store',
        body: JSON.stringify({ path: file.path }),
      })
      if (!response.ok) throw new Error(`Request failed: ${response.status}`)
      const result = (await response.json()) as { url: string }
      if (popup) popup.location.href = result.url
      else window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch {
      popup?.close()
      toast({ title: t('shipments.fileOpenFailed'), type: 'error' })
    } finally {
      setViewingPath(null)
    }
  }

  const updateCopies = (path: string, delta: number) => {
    setCopiesByPath((current) => ({
      ...current,
      [path]: Math.min(5, Math.max(1, (current[path] ?? 1) + delta)),
    }))
  }

  const queuePrint = async (file: DeliverableFile) => {
    const station = stationByPath[file.path] ?? ''
    const copies = copiesByPath[file.path] ?? 1
    if (!station) {
      toast({ title: t('shipments.choosePrinter'), type: 'warning' })
      return
    }
    if (!window.confirm(`${t('shipments.confirmPrint')} ${t(deliverableKey(file.kind))}?`)) {
      return
    }

    setPrintingPath(file.path)
    try {
      const response = await fetch('/api/shipments/print', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        cache: 'no-store',
        body: JSON.stringify({
          date,
          path: file.path,
          station,
          copies,
        }),
      })
      if (!response.ok) {
        if (response.status === 422) {
          toast({ title: t('shipments.zebraUnsupported'), type: 'error' })
          return
        }
        throw new Error(`Request failed: ${response.status}`)
      }
      const result = (await response.json()) as { queued: number }
      toast({
        title: t('shipments.printQueued'),
        description: `${result.queued} ${t('shipments.copiesQueued')}`,
        type: 'success',
      })
      await loadStatus()
    } catch {
      toast({ title: t('shipments.printFailed'), type: 'error' })
    } finally {
      setPrintingPath(null)
    }
  }

  const stationName = (stationId: string) =>
    stations.find((station) => station.id === stationId)?.name ?? stationId

  return (
    <div className="p-4 pb-20 md:p-6">
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Printer className="size-6 text-primary" />
            <h1 className="text-2xl font-bold">{t('shipments.printTitle')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('shipments.printSubtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <a
            href={SPS_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-4" />
            {t('shipments.spsPortal')}
          </a>
          <label className="text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">{t('shipments.fileDate')}</span>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
            />
          </label>
        </div>
      </div>

      {loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-52 animate-pulse rounded-xl border bg-muted/30" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">{t('shipments.loadError')}</p>
          <button
            type="button"
            onClick={() => void loadDeliverables()}
            className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t('shipments.tryAgain')}
          </button>
        </div>
      )}

      {!loading && !error && files.length === 0 && (
        <div className="rounded-xl border bg-card p-12 text-center">
          <FileText className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="text-sm font-medium">{t('shipments.noFilesForDate')}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('shipments.noFilesForDateHint')}
          </p>
        </div>
      )}

      {!loading && !error && files.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {files.map((file) => {
            const isLetter = LETTER_KINDS.has(file.kind)
            const selectedStation = stationByPath[file.path] ?? ''
            const copies = copiesByPath[file.path] ?? 1

            return (
              <article key={file.path} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{t(deliverableKey(file.kind))}</h2>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{file.name}</p>
                  </div>
                  <FileText className="size-5 shrink-0 text-primary" />
                </div>

                <button
                  type="button"
                  onClick={() => void viewFile(file)}
                  disabled={viewingPath === file.path}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {viewingPath === file.path ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  {viewingPath === file.path ? t('shipments.opening') : t('shipments.view')}
                </button>

                {file.kind === 'labels' && (
                  <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    {t('shipments.labelPrintNote')}
                  </p>
                )}

                {isLetter && canPrint && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <label className="block text-xs font-medium text-muted-foreground">
                      <span className="mb-1 block">{t('shipments.printer')}</span>
                      <select
                        value={selectedStation}
                        onChange={(event) =>
                          setStationByPath((current) => ({
                            ...current,
                            [file.path]: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground"
                      >
                        <option value="">{t('shipments.choosePrinter')}</option>
                        {stations.map((station) => (
                          <option key={station.id} value={station.id}>{station.name}</option>
                        ))}
                      </select>
                    </label>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        {t('shipments.copies')}
                      </span>
                      <div className="flex items-center rounded-lg border bg-background">
                        <button
                          type="button"
                          onClick={() => updateCopies(file.path, -1)}
                          disabled={copies <= 1}
                          className="p-2 disabled:opacity-30"
                          aria-label={t('shipments.decreaseCopies')}
                        >
                          <Minus className="size-4" />
                        </button>
                        <span className="w-8 text-center text-sm font-semibold">{copies}</span>
                        <button
                          type="button"
                          onClick={() => updateCopies(file.path, 1)}
                          disabled={copies >= 5}
                          className="p-2 disabled:opacity-30"
                          aria-label={t('shipments.increaseCopies')}
                        >
                          <Plus className="size-4" />
                        </button>
                      </div>
                    </div>

                    {stations.length === 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t('shipments.noApprovedPrinters')}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={() => void queuePrint(file)}
                      disabled={!selectedStation || printingPath !== null}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      {printingPath === file.path ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Printer className="size-4" />
                      )}
                      {printingPath === file.path
                        ? t('shipments.queueing')
                        : t('shipments.sendToPrinter')}
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {canPrint && (
        <section className="mt-6 overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">{t('shipments.printStatus')}</h2>
            <p className="text-xs text-muted-foreground">{t('shipments.printStatusHint')}</p>
          </div>
          {jobs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t('shipments.noPrintJobs')}</p>
          ) : (
            <div className="divide-y">
              {jobs.map((job) => (
                <div key={job.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <span className="mt-0.5">
                    <JobStatusIcon status={job.status} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="font-medium">{stationName(job.station_id)}</p>
                      <time className="text-xs text-muted-foreground">
                        {formatEtTimestamp(job.printed_at ?? job.created_at)}
                      </time>
                    </div>
                    <p className="text-xs text-muted-foreground">{t(statusKey(job.status))}</p>
                    {job.error && (
                      <p className="mt-1 break-words text-xs text-destructive">{job.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
