'use client'

import { useState } from 'react'
import { Camera } from 'lucide-react'
import { Lightbox } from './Lightbox'
import { getPhotoUrls } from '@/lib/drive-utils'

interface PhotoGridProps {
  photos: string[]
  maxVisible?: number
  size?: 'sm' | 'md' | 'lg'
  /** Context for download file naming */
  context?: { ifNumber?: string; lineNumber?: string; photoType?: string }
}

export function PhotoGrid({ photos, maxVisible = 4, size = 'md', context }: PhotoGridProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [originRect, setOriginRect] = useState<DOMRect | null>(null)

  if (!photos || photos.length === 0) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground text-xs">
        <Camera className="size-3" />
        <span>No photos</span>
      </div>
    )
  }

  const visiblePhotos = photos.slice(0, maxVisible)
  const hiddenCount = photos.length - maxVisible

  const baseSize = { sm: 40, md: 56, lg: 80 }[size]

  const openLightbox = (index: number, e?: React.MouseEvent) => {
    if (e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setOriginRect(rect)
    }
    setCurrentIndex(index)
    setLightboxOpen(true)
  }

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const getScale = (i: number) => {
    if (hoveredIdx === null) return 1
    const dist = Math.abs(i - hoveredIdx)
    if (dist === 0) return 1.35
    if (dist === 1) return 1.15
    return 1
  }

  return (
    <>
      <div className="flex gap-1.5 flex-wrap items-end" onMouseLeave={() => setHoveredIdx(null)}>
        {visiblePhotos.map((photo, i) => {
          const scale = getScale(i)
          return (
            <button
              key={i}
              onClick={(e) => openLightbox(i, e)}
              onMouseEnter={() => setHoveredIdx(i)}
              className="rounded-lg overflow-hidden border-2 border-transparent hover:border-primary cursor-pointer bg-muted shrink-0"
              style={{
                width: baseSize * scale,
                height: baseSize * scale,
                transition: 'all 150ms ease-out',
                marginBottom: (scale - 1) * 8,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getPhotoUrls(photo).thumb}
                alt={`Photo ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
                }}
              />
            </button>
          )
        })}
        {hiddenCount > 0 && (
          <button
            onClick={() => openLightbox(maxVisible)}
            className="rounded-lg bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-all cursor-pointer"
            style={{ width: baseSize, height: baseSize }}
          >
            +{hiddenCount}
          </button>
        )}
      </div>

      {lightboxOpen && (
        <Lightbox
          images={photos}
          initialIndex={currentIndex}
          onClose={() => { setLightboxOpen(false); setOriginRect(null) }}
          context={context}
          originRect={originRect}
        />
      )}
    </>
  )
}
