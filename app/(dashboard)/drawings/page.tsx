'use client'

import { useEffect, useState, useCallback } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { Card, CardContent } from '@/components/ui/card'
import { getDriveThumbUrl } from '@/lib/drive-utils'
import type { Drawing } from '@/lib/google-sheets'
import { InventoryPopover } from '@/components/InventoryPopover'
import { useI18n } from '@/lib/i18n'

const TYPE_FILTERS = [
  { key: 'all', label: 'All Types' },
  { key: 'Tire', label: 'Tires' },
  { key: 'Hub', label: 'Hubs' },
  { key: 'Other', label: 'Other' },
] as const

type TypeKey = (typeof TYPE_FILTERS)[number]['key']

/* ── Carousel Lightbox ── */
function CarouselLightbox({
  urls,
  partNumber,
  onClose,
}: {
  urls: string[]
  partNumber: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const [idx, setIdx] = useState(0)
  const [direction, setDirection] = useState<'left' | 'right'>('right')
  const [animating, setAnimating] = useState(false)
  const total = urls.length

  const goNext = () => {
    if (animating || total <= 1) return
    setDirection('right')
    setAnimating(true)
    setTimeout(() => {
      setIdx((i) => (i + 1) % total)
      setAnimating(false)
    }, 300)
  }

  const goPrev = () => {
    if (animating || total <= 1) return
    setDirection('left')
    setAnimating(true)
    setTimeout(() => {
      setIdx((i) => (i - 1 + total) % total)
      setAnimating(false)
    }, 300)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  // Animation: current image slides out, next slides in from the correct direction
  const getTransform = () => {
    if (!animating) return 'translateX(0)'
    return direction === 'right' ? 'translateX(-100%)' : 'translateX(100%)'
  }

  const getEnterTransform = () => {
    if (!animating) return 'translateX(100%)'
    return 'translateX(0)'
  }

  const nextIdx = direction === 'right' ? (idx + 1) % total : (idx - 1 + total) % total

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors z-10"
      >
        <span className="text-2xl leading-none">&times;</span>
      </button>

      <div className="relative flex items-center w-full max-w-4xl px-12">
        {total > 1 && (
          <button
            onClick={goPrev}
            className="absolute left-2 z-10 text-white text-4xl hover:text-white/80 select-none"
          >
            ‹
          </button>
        )}

        <div className="w-full overflow-hidden rounded-lg relative max-h-[85vh] overflow-y-auto">
          {/* Current image */}
          <div
            style={{
              transform: getTransform(),
              transition: animating ? 'transform 300ms ease-in-out' : 'none',
              display: animating ? undefined : 'block',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getDriveThumbUrl(urls[idx], 1200)}
              alt={`${partNumber} drawing ${idx + 1}`}
              className="w-full bg-white/5 rounded-lg"
            />
          </div>
          {/* Incoming image — overlaid during animation only */}
          {animating && (
            <div
              className="absolute inset-0"
              style={{
                transform: getEnterTransform(),
                transition: 'transform 300ms ease-in-out',
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getDriveThumbUrl(urls[nextIdx], 1200)}
                alt={`${partNumber} drawing ${nextIdx + 1}`}
                className="w-full bg-white/5 rounded-lg"
              />
            </div>
          )}
        </div>

        {total > 1 && (
          <button
            onClick={goNext}
            className="absolute right-2 z-10 text-white text-4xl hover:text-white/80 select-none"
          >
            ›
          </button>
        )}
      </div>

      <p className="text-white font-semibold mt-3 text-sm">{partNumber}</p>
      {total > 1 && (
        <p className="text-white/60 text-xs mt-1">Drawing {idx + 1} of {total}</p>
      )}
    </div>
  )
}

/* ── Mini Carousel for comparison tiles ── */
function MiniCarousel({ urls, partNumber }: { urls: string[]; partNumber: string }) {
  const [idx, setIdx] = useState(0)
  const total = urls.length

  return (
    <div className="relative w-full">
      <div className="overflow-hidden rounded-lg">
        <div
          className="flex"
          style={{
            transform: `translateX(-${idx * 100}%)`,
            transition: 'transform 300ms ease-in-out',
          }}
        >
          {urls.map((url, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={getDriveThumbUrl(url, 1200)}
              alt={`${partNumber} drawing ${i + 1}`}
              className="w-full flex-shrink-0 object-contain max-h-[70vh] bg-white/5"
            />
          ))}
        </div>
      </div>
      {total > 1 && (
        <div className="flex items-center justify-center gap-2 mt-1">
          <button
            onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + total) % total) }}
            className="text-white/70 hover:text-white text-lg select-none"
          >‹</button>
          <span className="text-white/50 text-xs">{idx + 1}/{total}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % total) }}
            className="text-white/70 hover:text-white text-lg select-none"
          >›</button>
        </div>
      )}
    </div>
  )
}

/* ── Helper: get drawing URLs array ── */
function getDrawingUrls(d: Drawing): string[] {
  const urls: string[] = []
  if (d.drawing1Url) urls.push(d.drawing1Url)
  if (d.drawing2Url) urls.push(d.drawing2Url)
  return urls
}

export default function DrawingsPage() {
  const { t } = useI18n()
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeKey>('all')

  // Lightbox
  const [lightbox, setLightbox] = useState<{ urls: string[]; partNumber: string } | null>(null)

  // Compare mode
  const [compareMode, setCompareMode] = useState(false)
  const [selected, setSelected] = useState<Drawing[]>([])
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    fetch('/api/drawings')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch drawings')
        return res.json()
      })
      .then((data: Drawing[]) => setDrawings(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!showCompare) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowCompare(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showCompare])

  const filtered = drawings.filter((d) => {
    if (typeFilter !== 'all' && d.productType !== typeFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!d.partNumber.toLowerCase().includes(q) && !d.product.toLowerCase().includes(q)) return false
    }
    return true
  })

  const toggleSelect = useCallback((drawing: Drawing) => {
    setSelected((prev) => {
      const exists = prev.some((d) => d.partNumber === drawing.partNumber)
      if (exists) return prev.filter((d) => d.partNumber !== drawing.partNumber)
      if (prev.length >= 8) return prev
      return [...prev, drawing]
    })
  }, [])

  const handleCardClick = (drawing: Drawing) => {
    if (compareMode) {
      toggleSelect(drawing)
    } else {
      const urls = getDrawingUrls(drawing)
      if (urls.length > 0) {
        setLightbox({ urls, partNumber: drawing.partNumber })
      }
    }
  }

  const isSelected = (drawing: Drawing) => selected.some((d) => d.partNumber === drawing.partNumber)

  const gridCols = showCompare
    ? selected.length <= 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : selected.length <= 4
      ? 'grid-cols-2'
      : 'grid-cols-2 lg:grid-cols-4'
    : ''

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📐 {t('page.drawings')}</h1>
        <button
          onClick={() => {
            setCompareMode((p) => !p)
            if (compareMode) setSelected([])
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            compareMode
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-background text-foreground border-border hover:bg-muted'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Compare
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        {filtered.length} drawing{filtered.length !== 1 ? 's' : ''} available
      </p>

      {/* Search */}
      <input
        type="text"
        placeholder={t('drawings.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full p-3 mb-4 rounded-lg bg-muted border border-border"
      />

      {/* Type filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              typeFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && (
        <TableSkeleton rows={8} />
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((drawing, i) => {
            const urls = getDrawingUrls(drawing)
            const hasBoth = urls.length === 2

            return (
              <Card
                key={`${drawing.partNumber}-${i}`}
                className={`overflow-hidden cursor-pointer transition-transform duration-200 hover:scale-105 hover:shadow-lg hover:z-10 relative ${
                  compareMode && isSelected(drawing) ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => handleCardClick(drawing)}
              >
                {compareMode && (
                  <div className={`absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded border-2 flex items-center justify-center text-xs ${
                    isSelected(drawing)
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-background/80 border-border'
                  }`}>
                    {isSelected(drawing) && '✓'}
                  </div>
                )}
                <div className="h-[180px] bg-muted flex items-center justify-center p-1">
                  {urls.length > 0 ? (
                    <div className={`flex ${hasBoth ? 'gap-1' : 'justify-center'} w-full h-full`}>
                      {urls.map((url, j) => (
                        <div key={j} className={`flex flex-col items-center ${hasBoth ? 'w-1/2' : 'w-full'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getDriveThumbUrl(url, 300)}
                            alt={`${drawing.partNumber} drawing ${j + 1}`}
                            className="w-full h-full object-contain flex-1 min-h-0"
                            onError={(e) => { e.currentTarget.src = '/placeholder-drawing.svg' }}
                          />
                          {hasBoth && (
                            <span className="text-[8px] text-muted-foreground mt-0.5">Dwg {j + 1}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs text-center p-2">
                      No drawing
                    </div>
                  )}
                </div>
                <CardContent className="p-2">
                  <div className="flex items-center gap-1">
                    <p className="font-semibold text-xs truncate">{drawing.partNumber}</p>
                    <InventoryPopover partNumber={drawing.partNumber} partType={drawing.productType === 'Tire' ? 'tire' : drawing.productType === 'Hub' ? 'hub' : 'part'} />
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`text-[9px] px-1 py-px rounded ${
                      drawing.productType === 'Tire' ? 'bg-orange-500/20 text-orange-500'
                      : drawing.productType === 'Hub' ? 'bg-teal-500/20 text-teal-500'
                      : 'bg-gray-500/20 text-gray-400'
                    }`}>{drawing.productType}</span>
                    {drawing.moldType && (
                      <span className="text-[9px] text-muted-foreground truncate" title={drawing.moldType}>🔧 {drawing.moldType}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-10">
              No drawings found
            </div>
          )}
        </div>
      )}

      {/* Compare floating bar */}
      {compareMode && selected.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-background border border-border rounded-xl shadow-xl px-4 py-3 flex items-center gap-3">
          <span className="text-sm font-medium">{selected.length} selected</span>
          <button
            onClick={() => setShowCompare(true)}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            View Comparison
          </button>
          <button
            onClick={() => setSelected([])}
            className="px-3 py-1.5 rounded-lg bg-muted text-sm hover:bg-muted/80 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* Carousel Lightbox */}
      {lightbox && (
        <CarouselLightbox
          urls={lightbox.urls}
          partNumber={lightbox.partNumber}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* Comparison Modal */}
      {showCompare && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowCompare(false) }}
        >
          <button
            onClick={() => setShowCompare(false)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          >
            <span className="text-2xl leading-none">&times;</span>
          </button>
          <div className={`grid ${gridCols} gap-4 max-h-[90vh] overflow-auto w-full max-w-6xl`}>
            {selected.map((drawing, i) => {
              const urls = getDrawingUrls(drawing)
              return (
                <div key={`compare-${drawing.partNumber}-${i}`} className="flex flex-col items-center">
                  {urls.length > 0 ? (
                    <MiniCarousel urls={urls} partNumber={drawing.partNumber} />
                  ) : (
                    <div className="text-white/40 text-sm">{t('drawings.noDrawing')}</div>
                  )}
                  <p className="text-white font-semibold mt-2 text-sm">{drawing.partNumber}</p>
                  <p className="text-white/60 text-xs">{drawing.productType}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
