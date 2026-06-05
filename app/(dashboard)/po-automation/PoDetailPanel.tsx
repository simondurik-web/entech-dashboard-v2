'use client'

import { useEffect, useState } from 'react'
import { FileText, ExternalLink, ImageOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import { PdfViewer } from '@/components/ui/PdfViewer'
import type { ProcessedPo } from '@/lib/po-automation/types'

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
export function PoDetailPanel({ po }: { po: ProcessedPo }) {
  const { t } = useI18n()
  const screenshots = Array.isArray(po.screenshot_urls)
    ? po.screenshot_urls.filter((u): u is string => typeof u === 'string' && isSafeStorageUrl(u))
    : []
  const pdfUrl =
    typeof po.po_pdf_url === 'string' && isSafeStorageUrl(po.po_pdf_url) ? po.po_pdf_url : null

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const lightboxOpen = lightboxIndex !== null

  // If the row data refreshes and the gallery shrinks while the lightbox is
  // open, close it rather than index past the end of the array.
  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= screenshots.length) {
      setLightboxIndex(null)
    }
  }, [lightboxIndex, screenshots.length])

  const showPrev = () =>
    setLightboxIndex((i) => (i === null ? null : (i - 1 + screenshots.length) % screenshots.length))
  const showNext = () =>
    setLightboxIndex((i) => (i === null ? null : (i + 1) % screenshots.length))

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {/* Original customer PO PDF */}
      <section className="min-w-0">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="size-4" />
          {t('po.detail.originalPo')}
        </h3>
        {pdfUrl ? (
          <PdfViewer url={pdfUrl} title={t('po.detail.originalPo')} />
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

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={(open) => !open && setLightboxIndex(null)}>
        <DialogContent className="max-w-4xl gap-2">
          <DialogTitle className="text-sm">
            {lightboxIndex !== null ? screenshotLabel(screenshots[lightboxIndex]) : ''}
          </DialogTitle>
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
