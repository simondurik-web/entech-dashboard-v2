'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, ExternalLink, ImageOff, ChevronLeft, ChevronRight, Pencil, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import { PdfViewer } from '@/components/ui/PdfViewer'
import { BillOfLadingSection } from '@/components/po-automation/BillOfLadingSection'
import { PoEditModal } from './PoEditModal'
import type { ProcessedPo } from '@/lib/po-automation/types'
import type { PoAuditEntry } from '@/lib/po-automation/edit'

/**
 * Only embed/load https URLs that live on Supabase storage. Today these URLs are
 * written by our own pipeline, but the email-extraction path will eventually
 * populate them from less-trusted input — so allowlist the host and reject
 * data:/blob:/http: before rendering them in an iframe or <img>.
 */
function isSafeStorageUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.supabase.co')
  } catch {
    return false
  }
}

/** Friendly label for a screenshot derived from its filename. */
function screenshotLabel(url: string): string {
  try {
    const file = decodeURIComponent(url.split('/').pop() ?? '')
    return file.replace(/\.[a-z0-9]+$/i, '')
  } catch {
    return url
  }
}

/**
 * Row-detail panel for a PO record: shows the customer's original PO PDF
 * (inline iframe + open-full link) and the Codex proof screenshots
 * (thumbnail gallery + click-to-enlarge lightbox).
 */
export function PoDetailPanel({ po, onChanged }: { po: ProcessedPo; onChanged?: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const { canAccess } = usePermissions()
  const canEdit = canAccess('/po-automation')
  const userId = user?.id ?? null
  const screenshots = Array.isArray(po.screenshot_urls)
    ? po.screenshot_urls.filter((u): u is string => typeof u === 'string' && isSafeStorageUrl(u))
    : []
  const pdfUrl =
    typeof po.po_pdf_url === 'string' && isSafeStorageUrl(po.po_pdf_url) ? po.po_pdf_url : null

  const [rawLightboxIndex, setLightboxIndex] = useState<number | null>(null)
  // Clamp during render rather than resetting in an effect: if the gallery
  // shrinks while open, an out-of-range index reads as closed (no setState).
  const lightboxIndex =
    rawLightboxIndex !== null && rawLightboxIndex >= screenshots.length ? null : rawLightboxIndex
  const lightboxOpen = lightboxIndex !== null
  const [editOpen, setEditOpen] = useState(false)

  // Audit history for this PO (newest first). The fetch's setHistory calls live
  // in async .then/.catch callbacks (allowed), not synchronously in the effect.
  const [history, setHistory] = useState<PoAuditEntry[]>([])
  const loadHistory = useCallback(() => {
    if (!canEdit) return
    fetch(`/api/po-automation/${po.id}`, {
      headers: { 'x-user-id': userId || '' },
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((data) => setHistory(Array.isArray(data?.entries) ? data.entries : []))
      .catch(() => setHistory([]))
  }, [po.id, userId, canEdit])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const showPrev = () =>
    setLightboxIndex((i) => (i === null ? null : (i - 1 + screenshots.length) % screenshots.length))
  const showNext = () =>
    setLightboxIndex((i) => (i === null ? null : (i + 1) % screenshots.length))

  const fmtDate = (value: string | null) => {
    if (!value) return ''
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
  }

  return (
    <div className="space-y-4">
      {/* Edit toolbar — only for users who can access /po-automation */}
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" />
            {t('po.edit.button')}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Original customer PO PDF */}
      <section className="min-w-0">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="size-4" />
          {t('po.detail.originalPo')}
        </h3>
        {pdfUrl ? (
          <PdfViewer key={pdfUrl} url={pdfUrl} title={t('po.detail.originalPo')} />
        ) : (
          <div className="flex h-[120px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            {t('po.detail.noPdf')}
          </div>
        )}
      </section>

      {/* Codex proof screenshots */}
      <section className="min-w-0">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="size-4" />
          {t('po.detail.screenshots')}
          {screenshots.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({screenshots.length})
            </span>
          )}
        </h3>
        {screenshots.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {screenshots.map((url, i) => (
              <button
                key={`${url}-${i}`}
                type="button"
                onClick={() => setLightboxIndex(i)}
                className="group relative overflow-hidden rounded-md border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
                title={screenshotLabel(url)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={screenshotLabel(url)}
                  loading="lazy"
                  className="h-24 w-full object-cover transition-transform group-hover:scale-105"
                />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white">
                  {screenshotLabel(url)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-[120px] items-center justify-center gap-1.5 rounded-md border border-dashed text-xs text-muted-foreground">
            <ImageOff className="size-4" />
            {t('po.detail.noScreenshots')}
          </div>
        )}
      </section>
      </div>

      {/* Bill of Lading — role-gated, full-width panel */}
      {canEdit && po.po_number && (
        <BillOfLadingSection
          key={`bol|${po.party ?? ''}|${po.po_number}`}
          customer={po.party ?? ''}
          poNumber={po.po_number}
          userId={userId}
          variant="panel"
          onOpenImage={(url) => {
            // Show BOL images in the same lightbox by appending to the gallery is
            // overkill — just open in a new tab for the panel context.
            window.open(url, '_blank', 'noopener,noreferrer')
          }}
        />
      )}

      {/* History / Changes */}
      {canEdit && history.length > 0 && (
        <section className="min-w-0">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" />
            {t('po.history.title')}
            <span className="text-xs font-normal text-muted-foreground">({history.length})</span>
          </h3>
          <ul className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-md border bg-muted/20 p-2.5 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {entry.changed_by_name || entry.changed_by || t('po.history.someone')}
                  </span>
                  <span>{fmtDate(entry.changed_at)}</span>
                </div>
                {Array.isArray(entry.changes) && entry.changes.length > 0 && (
                  <ul className="space-y-0.5">
                    {entry.changes.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-1">
                        <span className="font-mono text-[11px] text-muted-foreground">{c.field}:</span>
                        <span className="text-red-600 line-through dark:text-red-400">
                          {c.old === null || c.old === undefined || c.old === '' ? '∅' : String(c.old)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-green-600 dark:text-green-400">
                          {c.new === null || c.new === undefined || c.new === '' ? '∅' : String(c.new)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {entry.note && (
                  <p className="mt-1 italic text-muted-foreground">“{entry.note}”</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Edit modal */}
      {canEdit && editOpen && (
        <PoEditModal
          po={po}
          userId={userId}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            loadHistory()
            onChanged?.()
          }}
        />
      )}

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={(open) => !open && setLightboxIndex(null)}>
        <DialogContent className="max-w-4xl gap-2">
          <DialogTitle className="text-sm">
            {lightboxIndex !== null ? screenshotLabel(screenshots[lightboxIndex]) : ''}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('po.detail.screenshots')}</DialogDescription>
          {lightboxIndex !== null && (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshots[lightboxIndex]}
                alt={screenshotLabel(screenshots[lightboxIndex])}
                className="max-h-[75vh] w-full rounded-md object-contain"
              />
              {screenshots.length > 1 && (
                <>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={showPrev}
                    aria-label={t('po.detail.prev')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 opacity-90"
                  >
                    <ChevronLeft className="size-5" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={showNext}
                    aria-label={t('po.detail.next')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-90"
                  >
                    <ChevronRight className="size-5" />
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {lightboxIndex !== null ? `${lightboxIndex + 1} / ${screenshots.length}` : ''}
            </span>
            {lightboxIndex !== null && (
              <a
                href={screenshots[lightboxIndex]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
              >
                <ExternalLink className="size-3.5" />
                {t('po.detail.openFull')}
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
