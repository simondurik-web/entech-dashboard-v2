'use client'

import { useState } from 'react'
import { FileText, Download, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { PdfViewer } from '@/components/ui/PdfViewer'
import { useI18n } from '@/lib/i18n'

export interface PoMediaItem {
  url: string
  kind: 'pdf' | 'image'
  label?: string
}

const TILE_PX = { sm: 48, md: 64, lg: 80 } as const

/**
 * Compact media row for PO documents — renders each item as a small pallet-style
 * thumbnail (image preview, or a PDF tile) and opens a modal on click with the
 * full PDF viewer / enlarged image plus Open + Download. This replaces the old
 * full-width inline PDF that dominated the order-detail expansion on desktop.
 */
export function PoMediaThumbs({
  items,
  size = 'md',
}: {
  items: PoMediaItem[]
  size?: 'sm' | 'md' | 'lg'
}) {
  const { t } = useI18n()
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const px = TILE_PX[size]

  if (!items.length) return null

  const open = openIdx !== null && openIdx < items.length ? items[openIdx] : null
  const showPrev = () =>
    setOpenIdx((i) => (i === null ? null : (i - 1 + items.length) % items.length))
  const showNext = () =>
    setOpenIdx((i) => (i === null ? null : (i + 1) % items.length))

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <button
            key={`${it.url}-${i}`}
            type="button"
            onClick={() => setOpenIdx(i)}
            title={it.label || (it.kind === 'pdf' ? 'PDF' : '')}
            aria-label={it.label || (it.kind === 'pdf' ? 'PDF' : `${t('po.detail.screenshots')} ${i + 1}`)}
            className="relative shrink-0 overflow-hidden rounded-lg border bg-muted/40 transition-transform hover:scale-110 hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
            style={{ width: px, height: px }}
          >
            {it.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={it.url}
                alt={it.label || 'image'}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
                <FileText className="size-5" />
                <span className="text-[8px] font-semibold uppercase tracking-wide">PDF</span>
              </span>
            )}
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenIdx(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl gap-2 overflow-y-auto">
          <DialogTitle className="text-sm">
            {open?.label || (open?.kind === 'pdf' ? t('po.detail.originalPo') : t('po.detail.screenshots'))}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('po.media.previewDesc')}</DialogDescription>
          {open &&
            (open.kind === 'pdf' ? (
              <PdfViewer key={open.url} url={open.url} title={open.label} height={520} />
            ) : (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={open.url}
                  alt={open.label || 'image'}
                  className="max-h-[72vh] w-full rounded-md object-contain"
                />
              </div>
            ))}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={showPrev}
                    aria-label={t('po.detail.prev')}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="tabular-nums">
                    {(openIdx ?? 0) + 1} / {items.length}
                  </span>
                  <button
                    type="button"
                    onClick={showNext}
                    aria-label={t('po.detail.next')}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </>
              )}
            </div>
            {/* PDFs already expose Open + Download in the PdfViewer toolbar — only
                add these for the image branch to avoid a duplicate pair. */}
            {open && open.kind === 'image' && (
              <div className="flex items-center gap-3">
                <a
                  href={open.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                >
                  <ExternalLink className="size-3.5" />
                  {t('pdf.open')}
                </a>
                <a
                  href={open.url}
                  download
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
                >
                  <Download className="size-3.5" />
                  {t('pdf.download')}
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
