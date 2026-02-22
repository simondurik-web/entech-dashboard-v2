'use client'

import { useEffect, useCallback, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Download, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react'
import { getPhotoUrls } from '@/lib/drive-utils'

interface LightboxProps {
  images: string[]
  initialIndex: number
  onClose: () => void
  context?: { ifNumber?: string; lineNumber?: string; photoType?: string }
  /** Bounding rect of the clicked thumbnail for expand-from-origin animation */
  originRect?: DOMRect | null
}

export function Lightbox({ images, initialIndex, onClose, context, originRect }: LightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [hoveredThumb, setHoveredThumb] = useState<number | null>(null)
  const [slideDir, setSlideDir] = useState<'left' | 'right' | null>(null)
  const animRef = useRef<number>(0)
  const [entered, setEntered] = useState(false)

  // Zoom state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const panStart = useRef({ x: 0, y: 0 })
  const imgContainerRef = useRef<HTMLDivElement>(null)

  const currentImage = images[currentIndex]
  const { full: imageUrl } = getPhotoUrls(currentImage)
  const isZoomed = zoom > 1

  // Reset zoom on image change
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [currentIndex])

  const goNext = useCallback(() => {
    setSlideDir('left')
    animRef.current++
    setCurrentIndex((i) => (i + 1) % images.length)
  }, [images.length])

  const goPrev = useCallback(() => {
    setSlideDir('right')
    animRef.current++
    setCurrentIndex((i) => (i - 1 + images.length) % images.length)
  }, [images.length])

  useEffect(() => {
    if (!slideDir) return
    const t = setTimeout(() => setSlideDir(null), 250)
    return () => clearTimeout(t)
  }, [slideDir, animRef.current]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { if (isZoomed) { setZoom(1); setPan({ x: 0, y: 0 }) } else { onClose() } }
    if (e.key === 'ArrowRight' && !isZoomed) goNext()
    if (e.key === 'ArrowLeft' && !isZoomed) goPrev()
    if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(z + 0.5, 8))
    if (e.key === '-') { setZoom((z) => { const next = Math.max(z - 0.5, 1); if (next === 1) setPan({ x: 0, y: 0 }); return next }) }
  }, [onClose, goNext, goPrev, isZoomed])

  // Trigger enter animation after mount
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setEntered(true))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  // Scroll to zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -0.3 : 0.3
    setZoom((z) => {
      const next = Math.max(1, Math.min(z + delta, 8))
      if (next === 1) setPan({ x: 0, y: 0 })
      return next
    })
  }, [])

  // Click to toggle zoom
  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isZoomed) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    } else {
      // Zoom to 3x centered on click position
      const rect = imgContainerRef.current?.getBoundingClientRect()
      if (rect) {
        const relX = (e.clientX - rect.left) / rect.width - 0.5
        const relY = (e.clientY - rect.top) / rect.height - 0.5
        setZoom(3)
        setPan({ x: -relX * rect.width * 2, y: -relY * rect.height * 2 })
      } else {
        setZoom(3)
      }
    }
  }, [isZoomed])

  // Drag to pan when zoomed
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isZoomed) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY }
    panStart.current = { ...pan }
  }, [isZoomed, pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    e.stopPropagation()
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setPan({ x: panStart.current.x + dx, y: panStart.current.y + dy })
  }, [dragging])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
  }, [])

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

  const slideStyle = slideDir
    ? { animation: `slide-in-from-${slideDir} 250ms ease-out` }
    : {}

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <style jsx global>{`
        @keyframes slide-in-from-left {
          from { transform: translateX(60px); opacity: 0.3; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slide-in-from-right {
          from { transform: translateX(-60px); opacity: 0.3; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>

      <div
        className="fixed inset-0 z-[100] flex items-center justify-center transition-colors duration-300"
        style={{ backgroundColor: entered ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0)' }}
        onClick={isZoomed ? undefined : onClose}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10">
          <X className="size-6" />
        </button>

        {/* Counter + Zoom indicator */}
        <div className="absolute top-4 left-4 flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-full bg-white/10 text-white text-sm">
            {currentIndex + 1} / {images.length}
          </span>
          {isZoomed && (
            <span className="px-3 py-1.5 rounded-full bg-blue-500/30 text-blue-300 text-sm">
              {zoom.toFixed(1)}x — scroll to zoom, drag to pan, click to reset
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="absolute top-4 right-16 flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setZoom((z) => z >= 3 ? 1 : 3); if (zoom >= 3) setPan({ x: 0, y: 0 }) }}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title={isZoomed ? 'Zoom out' : 'Zoom in'}
          >
            {isZoomed ? <ZoomOut className="size-5" /> : <ZoomIn className="size-5" />}
          </button>
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

        {/* Navigation arrows — hide when zoomed */}
        {images.length > 1 && !isZoomed && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); goPrev() }}
              className="absolute left-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ChevronLeft className="size-8" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goNext() }}
              className="absolute right-4 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <ChevronRight className="size-8" />
            </button>
          </>
        )}

        {/* Image with zoom + pan + enter animation */}
        <div
          ref={imgContainerRef}
          className="max-w-[90vw] max-h-[85vh] flex items-center justify-center overflow-hidden"
          onClick={handleImageClick}
          onMouseDown={handleMouseDown}
          onWheel={handleWheel}
          style={{
            ...slideStyle,
            cursor: isZoomed ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            opacity: entered ? 1 : 0,
            transform: entered ? 'scale(1)' : 'scale(0.85)',
            transition: 'opacity 300ms ease-out, transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}
          key={currentIndex}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={`Photo ${currentIndex + 1}`}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl select-none"
            draggable={false}
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: dragging ? 'none' : 'transform 0.2s ease-out',
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>'
            }}
          />
        </div>

        {/* Thumbnail strip — hide when zoomed */}
        {images.length > 1 && !isZoomed && (
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
                  onClick={() => { setSlideDir(i > currentIndex ? 'left' : 'right'); setCurrentIndex(i) }}
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
    </>,
    document.body
  )
}
