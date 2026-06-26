'use client'

import { useMemo, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Same worker config as PdfCanvas — version-matched CDN URL so Next's bundler
// doesn't have to emit the worker as a chunk.
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

interface PdfAllPagesProps {
  url: string
  width?: number
  onError: () => void
}

/**
 * Renders EVERY page of a PDF stacked vertically (no toolbar, no text layer) —
 * used by WatermarkedPreview so a multi-page BOL is fully readable. Text layer
 * is off so the rendered pages aren't selectable/extractable.
 */
export default function PdfAllPages({ url, width, onError }: PdfAllPagesProps) {
  const file = useMemo(() => ({ url }), [url])
  const [numPages, setNumPages] = useState(0)

  return (
    <Document
      file={file}
      onLoadSuccess={({ numPages: n }) => setNumPages(n)}
      onLoadError={onError}
      onSourceError={onError}
      loading={
        <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      }
      error={
        <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
          Failed to load PDF
        </div>
      }
      className="flex flex-col items-center gap-2"
    >
      {Array.from({ length: numPages }, (_, i) => (
        <Page
          key={i}
          pageNumber={i + 1}
          width={width}
          renderAnnotationLayer={false}
          renderTextLayer={false}
          className="shadow-sm"
        />
      ))}
    </Document>
  )
}
