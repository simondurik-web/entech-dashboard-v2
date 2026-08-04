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
  DeliverablePartner,
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
  letter: boolean
  zebra: boolean
}

interface PrintJob {
  id: string
  station_id: string
  status: string
  error: string | null
  created_at: string
  printed_at: string | null
}

const LETTER_KINDS = new Set<DeliverableKind>([
  'packing-fedex',
  'packing-ltl',
  'packing-ups',
  'summary',
])
const FILE_ORDER: DeliverableKind[] = [
  'packing-fedex',
  'packing-ltl',
  'packing-ups',
  'labels',
  'summary',
  'other',
]
// Partner-first grouping: each automation's files sit together on screen so
// the floor never prints one partner's pile from the other's card by mistake.
const PARTNER_ORDER: DeliverablePartner[] = ['home-depot', 'amazon', 'shopify', 'unknown']

function deliverableKey(kind: DeliverableKind): string {
  const keys: Record<DeliverableKind, string> = {
    'packing-fedex': 'shipments.filePackingFedex',
    'packing-ltl': 'shipments.filePackingLtl',
    'packing-ups': 'shipments.filePackingUps',
    labels: 'shipments.fileLabels',
    summary: 'shipments.fileRunSummary',
    other: 'shipments.fileOther',
  }
  return keys[kind]
}

function partnerKey(partner: DeliverablePartner): string {
  const keys: Record<DeliverablePartner, string> = {
    'home-depot': 'shipments.partnerHomeDepot',
    amazon: 'shipments.partnerAmazon',
    shopify: 'shipments.partnerShopify',
    unknown: 'shipments.partnerUnknown',
  }
  return keys[partner]
}

const PARTNER_BADGE_CLASSES: Record<DeliverablePartner, string> = {
  'home-depot': 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  amazon: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  shopify: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  unknown: 'bg-muted text-muted-foreground',
}

function PartnerBadge({ partner }: { partner: DeliverablePartner }) {
  const { t } = useI18n()
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${PARTNER_BADGE_CLASSES[partner]}`}
    >
      {t(partnerKey(partner))}
    </span>
  )
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
  // Partner filter chips (Simon 2026-08-04): the floor prints one automation's
  // pile at a time, so let them narrow the cards to a single partner.
  const [partnerFilter, setPartnerFilter] = useState<DeliverablePartner | 'all'>('all')

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
          (left, right) =>
            PARTNER_ORDER.indexOf(left.partner) - PARTNER_ORDER.indexOf(right.partner) ||
            FILE_ORDER.indexOf(left.kind) - FILE_ORDER.indexOf(right.kind)
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
    // A partner picked for one date may not exist on another — never leave an
    // active chip pointing at an empty, disabled filter.
    setPartnerFilter('all')
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

  // Preselect per file type when exactly one CAPABLE station exists — letter
  // files preselect the letter station, label files the Zebra-capable one
  // (today both are "Shipping", but the pools are independent).
  useEffect(() => {
    if (stations.length === 0 || files.length === 0) return
    const letterStations = stations.filter((station) => station.letter)
    const zebraStations = stations.filter((station) => station.zebra)
    setStationByPath((current) => {
      const next = { ...current }
      for (const file of files) {
        if (next[file.path]) continue
        if (LETTER_KINDS.has(file.kind) && letterStations.length === 1) {
          next[file.path] = letterStations[0].id
        } else if (file.kind === 'labels' && zebraStations.length === 1) {
          next[file.path] = zebraStations[0].id
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
        // The route knows exactly why it refused; show THAT, not a generic
        // failure. Collapsing every case into one string is what turned a
        // plain "file is 21.5 MB, limit is 10 MB" into a morning of digging.
        const body = (await response.json().catch(() => ({}))) as {
          code?: string
          error?: string
          sizeMb?: number
          maxMb?: number
        }
        const key = body.code ? `shipments.print${body.code[0].toUpperCase()}${body.code.slice(1)}` : ''
        const localized = key ? t(key) : ''
        const message =
          localized && localized !== key
            ? localized
                .replace('{sizeMb}', String(body.sizeMb ?? ''))
                .replace('{maxMb}', String(body.maxMb ?? ''))
            : body.error || t('shipments.printFailed')
        toast({ title: message, type: 'error' })
        return
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
        <>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', ...PARTNER_ORDER] as const).map((option) => {
            const count =
              option === 'all' ? files.length : files.filter((file) => file.partner === option).length
            // Hide "unknown" entirely unless such files exist; other partners
            // stay visible but disabled at zero so the row reads consistently.
            if (option === 'unknown' && count === 0) return null
            const active = partnerFilter === option
            return (
              <button
                key={option}
                type="button"
                disabled={count === 0}
                onClick={() => setPartnerFilter(option)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted'
                }`}
              >
                {option === 'all' ? t('shipments.filterAll') : t(partnerKey(option))} ({count})
              </button>
            )
          })}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {files
            .filter((file) => partnerFilter === 'all' || file.partner === partnerFilter)
            .map((file) => {
            const isLetter = LETTER_KINDS.has(file.kind)
            const isLabels = file.kind === 'labels'
            // Only stations with the matching physical capability are offered —
            // the server enforces the same rule, this keeps the picker honest.
            const eligibleStations = stations.filter((station) =>
              isLabels ? station.zebra : station.letter
            )
            const selectedStation = stationByPath[file.path] ?? ''
            const copies = copiesByPath[file.path] ?? 1

            return (
              <article key={file.path} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{t(deliverableKey(file.kind))}</h2>
                      <PartnerBadge partner={file.partner} />
                    </div>
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

                {(isLetter || isLabels) && canPrint && (
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
                        {eligibleStations.map((station) => (
                          <option key={station.id} value={station.id}>
                            {station.name}{isLabels ? ` — ${t('shipments.zebraLabelPrinter')}` : ''}
                          </option>
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

                    {eligibleStations.length === 0 && (
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
        </>
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
