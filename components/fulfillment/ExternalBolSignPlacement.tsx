'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import { CheckCircle2, PenLine, RefreshCw } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { authHeaders } from '@/lib/session-token'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

// Tap-to-place the driver's captured signature onto the carrier's (external)
// BOL. The shipping crew sees the uploaded BOL, taps where the driver-signature
// box is on THAT carrier's form (every company's layout is different), adjusts
// the size, and saves — the server stamps the DN's receiver_signature PNG at
// that spot and stores the signed copy (print + records). Import with
// next/dynamic ssr:false (react-pdf is browser-only).

// The sign pad canvas is 600x200 — the placement box mirrors that aspect.
const SIG_ASPECT = 200 / 600

interface Placement {
  page: number // 0-based
  x: number // normalized top-left
  y: number
}

interface ExternalBolSignPlacementProps {
  dn: string
  /** already stamped once — offered as a redo */
  alreadySigned: boolean
  onSigned: () => void
}

export default function ExternalBolSignPlacement({ dn, alreadySigned, onSigned }: ExternalBolSignPlacementProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [numPages, setNumPages] = useState(0)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [wFrac, setWFrac] = useState(0.35)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageWidth, setPageWidth] = useState(560)
  const dragRef = useRef<{ page: number; el: HTMLDivElement } | null>(null)

  useEffect(() => {
    if (!open || blobUrl) return
    let revoked: string | null = null
    ;(async () => {
      try {
        const res = await fetch(
          `/api/erpnext/fulfillment/external-bol?dn=${encodeURIComponent(dn)}&raw=1&original=1`,
          { headers: authHeaders(), cache: 'no-store' }
        )
        if (!res.ok) throw new Error()
        const blob = await res.blob()
        revoked = URL.createObjectURL(blob)
        setBlobUrl(revoked)
      } catch {
        setLoadError(true)
      }
    })()
    return () => {
      if (revoked) URL.revokeObjectURL(revoked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dn])

  useEffect(() => {
    if (!open) return
    const el = containerRef.current
    if (el) setPageWidth(Math.max(280, Math.min(640, el.clientWidth - 8)))
  }, [open])

  const place = useCallback(
    (pageIndex: number, el: HTMLDivElement, clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const boxW = wFrac
      const boxH = ((wFrac * rect.width * SIG_ASPECT) / rect.height) || 0
      const x = Math.min(Math.max((clientX - rect.left) / rect.width - boxW / 2, 0), 1 - boxW)
      const y = Math.min(Math.max((clientY - rect.top) / rect.height - boxH / 2, 0), Math.max(1 - boxH, 0))
      setPlacement({ page: pageIndex, x, y })
    },
    [wFrac]
  )

  const doSave = async () => {
    if (!placement || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/erpnext/fulfillment/external-bol', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ dn, page: placement.page, x: placement.x, y: placement.y, w: wFrac }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        if (body?.error === 'not_signed') throw new Error(t('fulfillment.extBolNeedsSignature'))
        if (body?.error === 'unsupported_format') throw new Error(t('fulfillment.extBolUnsupported'))
        throw new Error(body?.error || t('fulfillment.extBolSaveFailed'))
      }
      setDone(true)
      setOpen(false)
      onSigned()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fulfillment.extBolSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
        <CheckCircle2 className="size-3.5" />
        {t('fulfillment.extBolSignedDone')}
      </p>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
      >
        <PenLine className="size-4" />
        {alreadySigned ? t('fulfillment.extBolRedoPlace') : t('fulfillment.extBolPlace')}
      </button>
    )
  }

  return (
    <div ref={containerRef} className="rounded-xl border border-border bg-card p-3">
      <p className="mb-1 text-sm font-semibold">{t('fulfillment.extBolPlaceTitle')}</p>
      <p className="mb-2 text-xs text-muted-foreground">{t('fulfillment.extBolPlaceHint')}</p>

      {loadError && <p className="text-xs text-destructive">{t('fulfillment.extBolLoadFailed')}</p>}

      {blobUrl && (
        <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-muted/40 p-1">
          <Document
            file={blobUrl}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            onLoadError={() => setLoadError(true)}
            onSourceError={() => setLoadError(true)}
            loading={<div className="p-6 text-center text-xs text-muted-foreground">…</div>}
            className="flex flex-col items-center gap-2"
          >
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                className="relative cursor-crosshair touch-none select-none"
                onPointerDown={(e) => {
                  const el = e.currentTarget as HTMLDivElement
                  dragRef.current = { page: i, el }
                  el.setPointerCapture(e.pointerId)
                  place(i, el, e.clientX, e.clientY)
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current
                  if (d && d.page === i && e.buttons > 0) place(i, d.el, e.clientX, e.clientY)
                }}
                onPointerUp={() => {
                  dragRef.current = null
                }}
              >
                <Page
                  pageNumber={i + 1}
                  width={pageWidth}
                  renderAnnotationLayer={false}
                  renderTextLayer={false}
                  className="shadow-sm"
                />
                {placement?.page === i && (
                  <div
                    className="pointer-events-none absolute flex items-center justify-center rounded border-2 border-dashed border-blue-600 bg-blue-500/15"
                    style={{
                      left: `${placement.x * 100}%`,
                      top: `${placement.y * 100}%`,
                      width: `${wFrac * 100}%`,
                      aspectRatio: `${1 / SIG_ASPECT}`,
                    }}
                  >
                    <span className="px-1 text-center text-[10px] font-bold leading-tight text-blue-700">
                      {t('fulfillment.extBolBoxLabel')}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </Document>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('fulfillment.extBolSize')}</span>
        <input
          type="range"
          min={15}
          max={70}
          value={Math.round(wFrac * 100)}
          onChange={(e) => setWFrac(Number(e.target.value) / 100)}
          className="flex-1"
        />
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-destructive">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => {
            setOpen(false)
            setPlacement(null)
            setError(null)
          }}
          disabled={saving}
          className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
        >
          {t('fulfillment.extBolCancel')}
        </button>
        <button
          onClick={doSave}
          disabled={!placement || saving}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {saving && <RefreshCw className="size-4 animate-spin" />}
          {saving ? t('fulfillment.extBolSaving') : t('fulfillment.extBolSave')}
        </button>
      </div>
    </div>
  )
}
