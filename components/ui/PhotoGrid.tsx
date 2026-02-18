'use client'

import { useState } from 'react'
import { Camera } from 'lucide-react'
import { Lightbox } from './Lightbox'
import { getPhotoUrls } from '@/lib/drive-utils'

interface PhotoGridProps {
  photos: string[]
  maxVisible?: number
  size?: 'sm' | 'md' | 'lg'
}

export function PhotoGrid({ photos, maxVisible = 4, size = 'md' }: PhotoGridProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

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

  const getImageUrl = (url: string): string => getPhotoUrls(url).thumb

  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-20 h-20',
  }

  const openLightbox = (index: number) => {
    setCurrentIndex(index)
    setLightboxOpen(true)
  }

  return (
    <>
      <div className="flex gap-1.5 flex-wrap">
        {visiblePhotos.map((photo, i) => (
          <button
            key={i}
            onClick={() => openLightbox(i)}
            className={`${sizeClasses[size]} rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all hover:scale-105 cursor-pointer bg-muted`}
          >
            <img
              src={getImageUrl(photo)}
              alt={`Photo ${i + 1}`}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="%23666" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
              }}
            />
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            onClick={() => openLightbox(maxVisible)}
            className={`${sizeClasses[size]} rounded-lg bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground hover:bg-muted/80 transition-colors cursor-pointer`}
          >
            +{hiddenCount}
          </button>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && (
        <Lightbox
          images={photos}
          currentIndex={currentIndex}
          onClose={() => setLightboxOpen(false)}
          onNext={() => setCurrentIndex((i) => Math.min(i + 1, photos.length - 1))}
          onPrev={() => setCurrentIndex((i) => Math.max(i - 1, 0))}
        />
      )}
    </>
  )
}
