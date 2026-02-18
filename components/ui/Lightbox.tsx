'use client'

import { useEffect, useCallback, useState } from 'react'
import { X, ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react'
import { getPhotoUrls } from '@/lib/drive-utils'

interface LightboxProps {
  images: string[]
  initialIndex: number
  onClose: () => void
  context?: { ifNumber?: string; lineNumber?: string; photoType?: string }
}

export function Lightbox({ images, initialIndex, onClose, context }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [hoveredThumb, setHoveredThumb] = useState<number | null>(null)

  const currentImage = images[currentIndex]
  const { full: imageUrl } = getPhotoUrls(currentImage)

  const goNext = useCallback(() => setCurrentIndex((i) => Math.min(i + 1, images.length - 1)), [images.length])
  const goPrev = useCallback(() => setCurrentIndex((i) => Math.max(i - 1, 0)), [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowRight') goNext()
    if (e.key === 'ArrowLeft') goPrev()
  }, [onClose, goNext, goPrev])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  const getFilename = () => {
    const prefix = context?.ifNumber ? `IF${context.ifNumber}` : context?.lineNumber ? `Line${context.lineNumber}` : 'photo'
    const type = context?.photoType || 'photo'
    return `${prefix}_${type}_${currentIndex + 1}.jpg`
  }

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = getFilename()
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(imageUrl, '_blank')
    }
  }

  const getThumbScale = (i: number) => {
    if (hoveredThumb === null) return i === currentIndex ? 1.15 : 1
    const dist = Math.abs(i - hoveredThumb)
    if (dist === 0) return 1.4
    if (dist === 1) return 1.2
    if (dist === 2) return 1.05
    return 1
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={onClose}>
      {/* Close */}
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10">
        <X className="size-6" />
      </button>

      {/* Counter */}
      <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Actions */}
      <div className="absolute top-4 right-16 flex gap-2">
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="size-5" />
        </a>
        <button
          onClick={(e) => { e.stopPropagation(); handleDownload() }}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          title={`Download as ${getFilename()}`}
        >
          <Download className="size-5" />
        </button>
      </div>

      {/* Previous */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); goPrev() }}
          className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronLeft className="size-8" />
        </button>
      )}

      {/* Image */}
      <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Photo ${currentIndex + 1}`}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
          }}
        />
      </div>

      {/* Next */}
      {currentIndex < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); goNext() }}
          className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronRight className="size-8" />
        </button>
      )}

      {/* Thumbnail strip — macOS dock effect + rounded corners */}
      {images.length > 1 && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-end gap-1.5 px-3 py-2 bg-black/60 backdrop-blur-md rounded-2xl max-w-[90vw] overflow-x-auto"
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setHoveredThumb(null)}
        >
          {images.map((img, i) => {
            const scale = getThumbScale(i)
            const { thumb } = getPhotoUrls(img)
            return (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                onMouseEnter={() => setHoveredThumb(i)}
                className="transition-all duration-150 ease-out rounded-lg overflow-hidden border-2 shrink-0"
                style={{
                  width: 48 * scale,
                  height: 48 * scale,
                  borderColor: i === currentIndex ? 'white' : 'transparent',
                  opacity: i === currentIndex ? 1 : 0.7,
                  marginBottom: (scale - 1) * 10,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb} alt={`${i + 1}`} className="w-full h-full object-cover" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
