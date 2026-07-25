'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, FileUp, Loader2, Printer, RotateCw } from 'lucide-react'
import { authedFetch } from '@/lib/authed-fetch'
import { useI18n } from '@/lib/i18n'
import { PdfViewer } from '@/components/ui/PdfViewer'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])

type PrinterOption = {
  id: string
  stationId: string
  name: string
  kind: 'paper' | 'label'
}

type Flash = {
  kind: 'ok' | 'err'
  message: string
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function RemotePrintingPage() {
  const { t } = useI18n()
  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printersLoading, setPrintersLoading] = useState(true)
  const [selectedPrinterId, setSelectedPrinterId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [copies, setCopies] = useState('1')
  const [printing, setPrinting] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [quarterTurns, setQuarterTurns] = useState(0)
  const [fitToPage, setFitToPage] = useState(true)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFlash = useCallback((kind: Flash['kind'], message: string, durationMs: number) => {
    setFlash({ kind, message })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlash(null), durationMs)
  }, [])

  // The API returns a stable `code`; translate it here so Spanish users never
  // see the English fallback the route ships for non-browser callers.
  const resolveError = useCallback(
    (body: unknown): string => {
      const payload = (body ?? {}) as {
        code?: unknown
        error?: unknown
        maxCopies?: unknown
        pages?: unknown
        max?: unknown
        page?: unknown
      }
      if (typeof payload.code === 'string') {
        const key = `remotePrinting.${payload.code}`
        const localized = t(key)
        if (localized !== key) {
          // {max} is the copy limit on the copies-related errors and the page
          // limit on the length one, so prefer the explicit `max` when sent.
          const max = typeof payload.max === 'number' ? payload.max : payload.maxCopies
          return localized
            .replace('{max}', typeof max === 'number' ? String(max) : '')
            .replace('{pages}', typeof payload.pages === 'number' ? String(payload.pages) : '')
            .replace('{page}', typeof payload.page === 'number' ? String(payload.page) : '')
        }
      }
      return typeof payload.error === 'string' ? payload.error : t('remotePrinting.errGeneric')
    },
    [t]
  )

  useEffect(() => {
    let cancelled = false
    const loadPrinters = async () => {
      try {
        const response = await authedFetch('/api/remote-print')
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(resolveError(body))
        }
        const nextPrinters = Array.isArray(body.printers)
          ? (body.printers as PrinterOption[])
          : []
        if (cancelled) return
        setPrinters(nextPrinters)
        setSelectedPrinterId(nextPrinters.length === 1 ? nextPrinters[0].id : '')
      } catch (error) {
        if (cancelled) return
        showFlash(
          'err',
          error instanceof Error ? error.message : t('remotePrinting.errGeneric'),
          20000
        )
      } finally {
        if (!cancelled) setPrintersLoading(false)
      }
    }
    loadPrinters()
    return () => {
      cancelled = true
    }
  }, [showFlash, t, resolveError])

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  // Ask the server for the finished page whenever the inputs change. The
  // preview is the SAME transformation the print uses, so what is on screen is
  // what comes out of the printer — the point of the whole feature.
  useEffect(() => {
    if (!file || !selectedPrinterId) {
      setPreviewUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setPreviewing(true)
    const run = async () => {
      try {
        const form = new FormData()
        form.set('file', file)
        form.set('printer', selectedPrinterId)
        form.set('copies', '1')
        form.set('preview', 'true')
        form.set('fit', fitToPage ? 'true' : 'false')
        form.set('rotate', String(quarterTurns))
        const response = await authedFetch('/api/remote-print', { method: 'POST', body: form })
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(resolveError(body))
        }
        const blob = await response.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      } catch (error) {
        if (cancelled) return
        setPreviewUrl(null)
        showFlash('err', error instanceof Error ? error.message : t('remotePrinting.errGeneric'), 20000)
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }
    run()
    return () => {
      cancelled = true
      // Release the blob this run created; a stale one would leak for the life
      // of the tab, and each preview is a whole PDF.
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file, selectedPrinterId, fitToPage, quarterTurns, resolveError, showFlash, t])

  const printerLabel = useCallback(
    (printer: PrinterOption) =>
      `${printer.name} — ${t(
        printer.kind === 'paper' ? 'remotePrinting.kindPaper' : 'remotePrinting.kindLabel'
      )}`,
    [t]
  )

  const clearFile = () => {
    setFile(null)
    setQuarterTurns(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const chooseFile = (chosen: File | undefined) => {
    if (!chosen) {
      clearFile()
      return
    }
    const isHeic =
      chosen.type === 'image/heic' ||
      chosen.type === 'image/heif' ||
      /\.hei[cf]$/i.test(chosen.name)
    if (isHeic) {
      clearFile()
      showFlash('err', t('remotePrinting.errHeic'), 20000)
      return
    }
    if (chosen.size > MAX_BYTES) {
      clearFile()
      showFlash('err', t('remotePrinting.errTooLarge'), 20000)
      return
    }
    // Some browsers/OSes report a generic or empty type for a perfectly good
    // PDF. Only pre-reject a type we positively recognize as wrong; the server
    // is the real gate and checks magic bytes.
    const typeIsMeaningful = Boolean(chosen.type) && chosen.type !== 'application/octet-stream'
    if (typeIsMeaningful && !ACCEPTED_TYPES.has(chosen.type)) {
      clearFile()
      showFlash('err', t('remotePrinting.errUnsupported'), 20000)
      return
    }
    setFile(chosen)
    setQuarterTurns(0)
    setFlash(null)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!file || !selectedPrinterId || busyRef.current) return

    const selectedPrinter = printers.find((printer) => printer.id === selectedPrinterId)
    if (!selectedPrinter) return

    const copyCount = Math.min(20, Math.max(1, Math.trunc(Number(copies)) || 1))
    busyRef.current = true
    setPrinting(true)
    setFlash(null)

    try {
      const form = new FormData()
      form.set('file', file)
      form.set('printer', selectedPrinterId)
      form.set('copies', String(copyCount))
      // Identical to the preview request, so the approved page is what prints.
      form.set('fit', fitToPage ? 'true' : 'false')
      form.set('rotate', String(quarterTurns))
      const response = await authedFetch('/api/remote-print', {
        method: 'POST',
        body: form,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(resolveError(body))
      }

      clearFile()
      showFlash(
        'ok',
        t('remotePrinting.success')
          .replace('{copies}', String(body.queued ?? copyCount))
          .replace('{printer}', printerLabel(selectedPrinter)),
        5000
      )
    } catch (error) {
      showFlash(
        'err',
        error instanceof Error ? error.message : t('remotePrinting.errGeneric'),
        20000
      )
    } finally {
      setPrinting(false)
      busyRef.current = false
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Printer className="h-6 w-6" />
          {t('remotePrinting.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('remotePrinting.subtitle')}</p>
      </header>

      {flash && (
        <div
          role={flash.kind === 'err' ? 'alert' : 'status'}
          className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm ${
            flash.kind === 'ok'
              ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'
              : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {flash.kind === 'ok' ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{flash.message}</span>
        </div>
      )}

      {printersLoading ? (
        <div className="flex min-h-40 items-center justify-center rounded-xl border border-border bg-card p-6">
          <Loader2
            className="h-6 w-6 animate-spin text-muted-foreground"
            aria-label={t('remotePrinting.loadingPrinters')}
          />
        </div>
      ) : printers.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <Printer className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">{t('remotePrinting.noPrinters')}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-card p-4">
          <div>
            <label
              htmlFor="remote-print-file"
              className="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-accent"
            >
              <FileUp className="h-4 w-4" />
              {t('remotePrinting.chooseFile')}
            </label>
            <input
              ref={fileInputRef}
              id="remote-print-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <div className="mt-2 min-w-0 text-sm text-muted-foreground">
              {file ? (
                <>
                  <div className="break-all font-medium text-foreground">{file.name}</div>
                  <div>{humanFileSize(file.size)}</div>
                </>
              ) : (
                t('remotePrinting.noFileChosen')
              )}
            </div>
          </div>

          <div>
            <label htmlFor="remote-print-printer" className="mb-1.5 block text-sm font-medium">
              {t('remotePrinting.printer')}
            </label>
            <select
              id="remote-print-printer"
              value={selectedPrinterId}
              onChange={(event) => setSelectedPrinterId(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              required
            >
              <option value="" disabled>
                {t('remotePrinting.selectPrinter')}
              </option>
              {printers.map((printer) => (
                <option key={printer.id} value={printer.id}>
                  {printerLabel(printer)}
                </option>
              ))}
            </select>
          </div>

          {file && selectedPrinterId && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{t('remotePrinting.preview')}</span>
                <div className="flex items-center gap-3">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fitToPage}
                      onChange={(event) => setFitToPage(event.target.checked)}
                      className="size-4"
                    />
                    {t('remotePrinting.fitToPage')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setQuarterTurns((turns) => (turns + 1) % 4)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-accent"
                  >
                    <RotateCw className="h-4 w-4" />
                    {t('remotePrinting.rotate')}
                  </button>
                </div>
              </div>
              {previewing ? (
                <div className="flex min-h-40 items-center justify-center rounded-md border border-border bg-muted/30">
                  <Loader2
                    className="h-6 w-6 animate-spin text-muted-foreground"
                    aria-label={t('remotePrinting.previewLoading')}
                  />
                </div>
              ) : previewUrl ? (
                <PdfViewer
                  key={previewUrl}
                  url={previewUrl}
                  title={file.name}
                  height={420}
                />
              ) : (
                <div className="rounded-md border border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                  {t('remotePrinting.previewUnavailable')}
                </div>
              )}
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('remotePrinting.previewHint')}
              </p>
            </div>
          )}

          <div>
            <label htmlFor="remote-print-copies" className="mb-1.5 block text-sm font-medium">
              {t('remotePrinting.copies')}
            </label>
            <input
              id="remote-print-copies"
              type="number"
              min={1}
              max={20}
              step={1}
              required
              value={copies}
              onChange={(event) => setCopies(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <button
            type="submit"
            disabled={!file || !selectedPrinterId || printing}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {printing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('remotePrinting.printing')}
              </>
            ) : (
              <>
                <Printer className="h-4 w-4" />
                {t('remotePrinting.print')}
              </>
            )}
          </button>
        </form>
      )}
    </div>
  )
}
