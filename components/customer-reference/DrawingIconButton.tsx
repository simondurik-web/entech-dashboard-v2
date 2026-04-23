'use client'

import { useState } from 'react'
import { FileImage, ExternalLink, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getDriveThumbUrl } from '@/lib/drive-utils'
import { sanitizeDrawingUrl } from '@/lib/customer-reference-bom'
import { useI18n } from '@/lib/i18n'

interface DrawingIconButtonProps {
  partNumber: string
  drawingUrl: string | null
}

export function DrawingIconButton({ partNumber, drawingUrl }: DrawingIconButtonProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  // Defence-in-depth: the URL is already sanitized by fetchBomMaps, but guard again here
  // in case a caller passes an unchecked value.
  const safeUrl = sanitizeDrawingUrl(drawingUrl)
  const hasDrawing = safeUrl !== null
  const label = hasDrawing ? t('customerRef.viewDrawing') : t('customerRef.noDrawing')

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
            ? 'inline-flex items-center justify-center size-[18px] rounded-[4px] text-[10px] leading-none bg-muted/50 hover:bg-primary/20 hover:text-primary text-muted-foreground/60 transition-all duration-150 hover:scale-110 active:scale-95 shrink-0'
            : 'inline-flex items-center justify-center size-[18px] rounded-[4px] text-[10px] leading-none bg-muted/20 text-muted-foreground/30 cursor-not-allowed shrink-0'
        }
      >
        <FileImage className="size-[11px]" />
      </button>

      {hasDrawing && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-4xl p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <DialogHeader className="px-4 py-3 border-b border-border/60">
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2 text-sm">
                  <FileImage className="size-4 text-primary" />
                  <span>{t('customerRef.drawingViewerTitle').replace('{pn}', partNumber)}</span>
                </DialogTitle>
                <div className="flex items-center gap-2">
                  <a
                    href={safeUrl!}
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
            <div className="flex items-center justify-center bg-black/20 min-h-[50vh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getDriveThumbUrl(safeUrl!, 1600)}
                alt={partNumber}
                className="max-h-[75vh] max-w-full object-contain"
                loading="lazy"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export default DrawingIconButton
