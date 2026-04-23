'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileImage, ExternalLink, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getDriveThumbUrl } from '@/lib/drive-utils'
import { sanitizeDrawingUrl } from '@/lib/customer-reference-bom'
import { useI18n } from '@/lib/i18n'

interface DrawingIconButtonProps {
  partNumber: string
  /** All drawings for this part, in original order. Empty array = no drawing available. */
  drawingUrls: string[]
}

export function DrawingIconButton({ partNumber, drawingUrls }: DrawingIconButtonProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)

  // Defence-in-depth: sanitize once again at the boundary. The array passed in is
  // already sanitized by fetchBomMaps, but a direct caller may not have done it.
  const safeUrls = useMemo(
    () => drawingUrls.map((u) => sanitizeDrawingUrl(u)).filter((u): u is string => typeof u === 'string'),
    [drawingUrls],
  )

  const count = safeUrls.length
  const hasDrawing = count > 0
  const label = hasDrawing ? t('customerRef.viewDrawing') : t('customerRef.noDrawing')
  const current = hasDrawing ? safeUrls[Math.min(idx, count - 1)] : null

  const goPrev = useCallback(() => setIdx((i) => (count === 0 ? 0 : (i - 1 + count) % count)), [count])
  const goNext = useCallback(() => setIdx((i) => (count === 0 ? 0 : (i + 1) % count)), [count])

  // Reset index on open via the Dialog's own onOpenChange — avoids a cascade-render effect.
  const handleOpenChange = useCallback((next: boolean) => {
    if (next) setIdx(0)
    setOpen(next)
  }, [])

  // Keyboard navigation while the dialog is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, goPrev, goNext])

  return (
    <>
      <button
        type="button"
        disabled={!hasDrawing}
        onClick={(e) => { e.stopPropagation(); if (hasDrawing) setOpen(true) }}
        title={label}
        aria-label={label}
        className={
          hasDrawing
            ? 'inline-flex items-center justify-center size-[18px] rounded-[4px] text-[10px] leading-none bg-muted/50 hover:bg-primary/20 hover:text-primary text-muted-foreground/60 transition-all duration-150 hover:scale-110 active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
            : 'inline-flex items-center justify-center size-[18px] rounded-[4px] text-[10px] leading-none bg-muted/20 text-muted-foreground/30 cursor-not-allowed shrink-0'
        }
      >
        <FileImage className="size-[11px]" />
      </button>

      {hasDrawing && (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="max-w-5xl p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <DialogHeader className="px-4 py-3 border-b border-border/60">
              <div className="flex items-center justify-between gap-3">
                <DialogTitle className="flex items-center gap-2 text-sm min-w-0">
                  <FileImage className="size-4 text-primary shrink-0" />
                  <span className="truncate">{t('customerRef.drawingViewerTitle').replace('{pn}', partNumber)}</span>
                  {count > 1 && (
                    <span
                      className="text-[11px] text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded shrink-0"
                      aria-live="polite"
                    >
                      {idx + 1} / {count}
                    </span>
                  )}
                </DialogTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={current!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    {t('customerRef.drawingOpenExternal')}
                    <ExternalLink className="size-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md p-1 hover:bg-muted transition-colors"
                    aria-label={t('ui.close')}
                  >
                    <X className="size-4 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </DialogHeader>

            <div className="relative flex items-center justify-center bg-black/30 min-h-[55vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current}
                src={getDriveThumbUrl(current!, 1600)}
                alt={`${partNumber} — ${idx + 1}/${count}`}
                className="max-h-[70vh] max-w-full object-contain"
                loading="lazy"
              />
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    aria-label={t('customerRef.drawingPrev')}
                    title={t('customerRef.drawingPrev')}
                    className="absolute left-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-background/70 hover:bg-background text-foreground shadow-lg backdrop-blur-sm flex items-center justify-center transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    aria-label={t('customerRef.drawingNext')}
                    title={t('customerRef.drawingNext')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-background/70 hover:bg-background text-foreground shadow-lg backdrop-blur-sm flex items-center justify-center transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}
            </div>

            {count > 1 && (
              <div className="flex items-center justify-center gap-2 px-4 py-3 border-t border-border/60 bg-muted/20">
                {safeUrls.map((url, i) => (
                  <button
                    key={url + i}
                    type="button"
                    onClick={() => setIdx(i)}
                    aria-label={t('customerRef.drawingGoto').replace('{n}', String(i + 1))}
                    aria-current={i === idx ? 'true' : undefined}
                    className={`relative rounded-md overflow-hidden border-2 transition-all ${
                      i === idx
                        ? 'border-primary ring-2 ring-primary/30 scale-105'
                        : 'border-border/60 opacity-60 hover:opacity-100'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getDriveThumbUrl(url, 200)}
                      alt=""
                      className="h-14 w-20 object-contain bg-background"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export default DrawingIconButton
