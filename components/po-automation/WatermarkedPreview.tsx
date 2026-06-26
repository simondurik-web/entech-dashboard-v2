'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { FileWarning, Loader2 } from 'lucide-react'

// Reuse react-pdf (same worker config as PdfCanvas) to render EVERY page, but
// WITHOUT a download/print toolbar — a BOL must be fully readable yet not printable.
const PdfAllPages = dynamic(() => import('@/components/ui/PdfAllPages'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[280px] items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  ),
})

/**
 * Non-printable, watermarked preview of a BOL (all PDF pages, or an image). The
 * ENTIRE document is shown (scrollable) so a manager can read every detail, but
 * every affordance to obtain a clean copy is removed: no download / open links,
 * pages are rasterized (no text layer), drag + right-click are blocked, a heavy
 * tiled diagonal "NOT VALID" stamp covers the full height, and a disclaimer
 * banner is pinned at the top. The clean copy is released only from the Shipped
 * section after the load is scanned + sent. Screenshots are deliberately fine —
 * any capture is defaced by the stamp.
 *
 * SCOPE LIMIT (closed in Slice 2): this stops the CASUAL bypass — the floor
 * worker who would click print and hand a clean BOL to the driver. It is NOT a
 * hard control: the BOL lives in a PUBLIC storage bucket, so `url` is fetchable
 * from the browser's network tab and the overlay is removable in devtools. The
 * airtight fix (private bucket + a status-gated server endpoint that rasterizes
 * + watermarks server-side, returning clean bytes only once shipped) lands with
 * the ERPNext scan-gate in Slice 2.
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
  /** Disclaimer sentence (the "scan in ERPNext to release" message). */
  disclaimer: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [pdfFailed, setPdfFailed] = useState(false)

  // Render the PDF pages at the container's width so they fill the panel. A
  // ResizeObserver (not just window resize) catches the panel expand/collapse
  // that drives this UI — including a 0-width first mount inside a closed panel.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth
      if (w && w > 0) setWidth(Math.min(w, 720))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Tiled diagonal stamp as an inline SVG background — repeats across the whole
  // document height so no part of any page is clean.
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
      {/* Scroll viewport — the WHOLE BOL is reachable; tall docs scroll. */}
      <div className="max-h-[78vh] overflow-y-auto">
        {/* Disclaimer banner — sticky so it stays visible while scrolling without
            covering the document header at the top. */}
        <div className="pointer-events-none sticky top-0 z-10 flex justify-center p-2">
          <div className="max-w-[92%] rounded-md border-2 border-red-500/70 bg-background/90 px-3 py-1.5 text-center shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wide text-red-600">{stampText}</div>
            <div className="mt-0.5 text-[11px] font-medium text-foreground">{disclaimer}</div>
          </div>
        </div>
        {/* Content wrapper sized to the full document so the stamp covers it all */}
        <div className="relative flex justify-center">
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt="BOL preview"
              draggable={false}
              className="pointer-events-none w-full object-contain"
            />
          ) : pdfFailed ? (
            <div className="flex h-[280px] flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
              <FileWarning className="size-5" />
              {disclaimer}
            </div>
          ) : (
            <div className="pointer-events-none w-full">
              <PdfAllPages url={url} width={width} onError={() => setPdfFailed(true)} />
            </div>
          )}

          {/* Tiled diagonal stamp over the full document height */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: `url("data:image/svg+xml,${tile}")`, backgroundRepeat: 'repeat' }}
          />
        </div>
      </div>
    </div>
  )
}
