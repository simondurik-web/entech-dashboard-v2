'use client'

import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Download, ExternalLink } from 'lucide-react'

interface LightboxProps {
  images: string[]
  currentIndex: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

export function Lightbox({ images, currentIndex, onClose, onNext, onPrev }: LightboxProps) {
  const currentImage = images[currentIndex]
  
  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNext()
    if (e.key === 'ArrowLeft' && currentIndex > 0) onPrev()
  }, [currentIndex, images.length, onClose, onNext, onPrev])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  // Extract image URL from Google Drive format if needed
  const getImageUrl = (url: string): string => {
    // Handle Google Drive URLs
    const driveMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/)
    if (driveMatch) {
      return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`
    }
    return url
  }

  const imageUrl = getImageUrl(currentImage)

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
        aria-label="Close"
      >
        <X className="size-6" />
      </button>

      {/* Image counter */}
      <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Action buttons */}
      <div className="absolute top-4 right-16 flex gap-2">
        <a
          href={imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Open in new tab"
        >
          <ExternalLink className="size-5" />
        </a>
        <a
          href={imageUrl}
          download
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Download"
        >
          <Download className="size-5" />
        </a>
      </div>

      {/* Previous button */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev() }}
          className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Previous"
        >
          <ChevronLeft className="size-8" />
        </button>
      )}

      {/* Image */}
      <div 
        className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt={`Photo ${currentIndex + 1}`}
          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          onError={(e) => {
            // Fallback for failed images
            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
          }}
        />
      </div>

      {/* Next button */}
      {currentIndex < images.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext() }}
          className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          aria-label="Next"
        >
          <ChevronRight className="size-8" />
        </button>
      )}

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-black/50 rounded-lg">
          {images.map((img, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                if (i < currentIndex) onPrev()
                else if (i > currentIndex) onNext()
              }}
              className={`w-12 h-12 rounded overflow-hidden border-2 transition-all ${
                i === currentIndex ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={getImageUrl(img)}
                alt={`Thumbnail ${i + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
