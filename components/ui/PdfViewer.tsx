'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ExternalLink, Download, FileText, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// react-pdf must not run during SSR (it touches DOMMatrix / canvas). Lazy-load
// the whole document renderer with ssr:false and configure the pdf.js worker to
// a version-matched CDN URL so Next 16's bundler doesn't have to resolve the
// worker as a module (which is what breaks the build).
const PdfCanvas = dynamic(() => import('./PdfCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  ),
})

interface PdfViewerProps {
  /** Allowlisted https URL of the PDF (caller must guard with isSafeStorageUrl). */
  url: string
  /** Accessible title for the document. */
  title?: string
  /** Height of the inline viewer in px. */
  height?: number
}

/**
 * Reusable inline PDF viewer. Renders the PDF to a <canvas> via react-pdf
 * (pdf.js) so it works on desktop AND mobile (mobile browsers can't embed a
 * PDF in an <iframe>). Always exposes "Open" + "Download" external links as a
 * reliable fallback path. Lazy-loaded client-side only.
 */
export function PdfViewer({ url, title, height = 420 }: PdfViewerProps) {
  const { t } = useI18n()
  const [numPages, setNumPages] = useState(0)
  const [page, setPage] = useState(1)
  const [failed, setFailed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>(0)

  // Track container width so the page scales responsively (phones included).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset when the source changes.
  useEffect(() => {
    setNumPages(0)
    setPage(1)
    setFailed(false)
  }, [url])

  return (
    <div className="overflow-hidden rounded-md border bg-muted/30">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b bg-background/60 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate">{title || 'PDF'}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {numPages > 1 && !failed && (
            <div className="flex items-center gap-1 text-xs">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label={t('pdf.prevPage')}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="tabular-nums">
                {page} / {numPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(numPages, p + 1))}
                disabled={page >= numPages}
                aria-label={t('pdf.nextPage')}
                className="rounded p-0.5 hover:bg-muted disabled:opacity-40"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            <ExternalLink className="size-3.5" />
            {t('pdf.open')}
          </a>
          <a
            href={url}
            download
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            <Download className="size-3.5" />
            {t('pdf.download')}
          </a>
        </div>
      </div>

      {/* Canvas render */}
      <div ref={containerRef} className="relative w-full overflow-auto" style={{ height }}>
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
            <FileText className="size-6" />
            <p>{t('pdf.cannotPreview')}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ExternalLink className="size-3.5" />
              {t('pdf.open')}
            </a>
          </div>
        ) : (
          <PdfCanvas
            url={url}
            page={page}
            width={width || undefined}
            onLoadSuccess={(n) => setNumPages(n)}
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </div>
  )
}

export default PdfViewer
