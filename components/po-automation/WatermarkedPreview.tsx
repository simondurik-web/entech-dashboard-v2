'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { FileWarning, Loader2 } from 'lucide-react'

// Reuse the same react-pdf canvas renderer the PdfViewer uses, but WITHOUT its
// Open/Download toolbar — for a BOL that must be previewable yet not printable.
const PdfCanvas = dynamic(() => import('@/components/ui/PdfCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[220px] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  ),
})

/**
 * Non-printable, watermarked preview of a BOL (PDF first page or image). The
 * customer's BOL stays visible so a manager can confirm the right file is on the
 * order, but every affordance to obtain a clean copy is removed: no download /
 * open links, the file is rendered (image) or rasterized to canvas (PDF, no text
 * layer), drag + right-click are blocked, and a heavy diagonal "NOT VALID" stamp
 * plus a center disclaimer deface any screenshot. The clean copy is released only
 * from the Shipped section after the load is scanned + sent. Honest limit: the
 * web can't block an OS screenshot — the watermark makes any capture useless.
 */
export function WatermarkedPreview({
  url,
  kind,
  stampText,
  disclaimer,
}: {
  url: string
  kind: 'pdf' | 'image'
  /** Short repeated diagonal stamp, e.g. "NOT VALID · NO VÁLIDO". */
  stampText: string
  /** Center disclaimer sentence (the "scan in ERPNext to release" message). */
  disclaimer: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [pdfFailed, setPdfFailed] = useState(false)

  // Render the PDF canvas at the container's width so it fills the panel.
  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current?.clientWidth
      if (w && w > 0) setWidth(Math.min(w, 720))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Tiled diagonal stamp as an inline SVG background — repeats across the whole
  // preview so no corner is clean.
  const tile = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='170'>` +
      `<text x='8' y='95' font-family='Helvetica,Arial,sans-serif' font-size='20' font-weight='700' ` +
      `fill='rgba(220,38,38,0.30)' transform='rotate(-28 150 85)'>${stampText}</text></svg>`
  )

  return (
    <div
      ref={wrapRef}
      className="relative select-none overflow-hidden rounded-md border bg-muted/30"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="flex max-h-[280px] justify-center overflow-hidden">
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="BOL preview"
            draggable={false}
            className="pointer-events-none max-h-[280px] w-full object-contain"
          />
        ) : pdfFailed ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
            <FileWarning className="size-5" />
            {disclaimer}
          </div>
        ) : (
          <div className="pointer-events-none">
            <PdfCanvas url={url} page={1} width={width} onLoadSuccess={() => {}} onError={() => setPdfFailed(true)} />
          </div>
        )}
      </div>

      {/* Tiled diagonal stamp */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: `url("data:image/svg+xml,${tile}")`, backgroundRepeat: 'repeat' }}
      />

      {/* Center disclaimer banner */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-3">
        <div className="max-w-[90%] rounded-md border-2 border-red-500/70 bg-background/85 px-3 py-2 text-center">
          <div className="text-[11px] font-bold uppercase tracking-wide text-red-600">{stampText}</div>
          <div className="mt-0.5 text-[11px] font-medium text-foreground">{disclaimer}</div>
        </div>
      </div>
    </div>
  )
}
