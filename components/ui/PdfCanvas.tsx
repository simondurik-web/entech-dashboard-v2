'use client'

import { useMemo } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure the pdf.js worker to a version-matched CDN URL. Using the bundled
// `pdfjs.version` guarantees the worker matches react-pdf's pinned pdfjs-dist
// (4.8.69), and pointing at a CDN avoids asking Next 16's bundler to emit the
// worker as a chunk (which is the part that historically breaks the build).
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

interface PdfCanvasProps {
  url: string
  page: number
  width?: number
  onLoadSuccess: (numPages: number) => void
  onError: () => void
}

export default function PdfCanvas({ url, page, width, onLoadSuccess, onError }: PdfCanvasProps) {
  // Memoize options so react-pdf doesn't reload the document on every render.
  const file = useMemo(() => ({ url }), [url])

  return (
    <Document
      file={file}
      onLoadSuccess={({ numPages }) => onLoadSuccess(numPages)}
      onLoadError={onError}
      onSourceError={onError}
      loading={
        <div className="flex h-[420px] items-center justify-center text-xs text-muted-foreground">
          Loading…
        </div>
      }
      error={
        <div className="flex h-[420px] items-center justify-center text-xs text-muted-foreground">
          Failed to load PDF
        </div>
      }
      className="flex justify-center"
    >
      <Page
        pageNumber={page}
        width={width}
        renderAnnotationLayer={false}
        renderTextLayer={false}
        className="shadow-sm"
      />
    </Document>
  )
}
