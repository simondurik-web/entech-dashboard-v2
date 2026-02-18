'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ImageModal } from '@/components/ImageModal'
import { getDriveThumbUrl } from '@/lib/drive-utils'
import type { Drawing } from '@/lib/google-sheets'

const TYPE_FILTERS = [
  { key: 'all', label: 'All Types' },
  { key: 'Tire', label: 'Tires' },
  { key: 'Hub', label: 'Hubs' },
  { key: 'Other', label: 'Other' },
] as const

type TypeKey = (typeof TYPE_FILTERS)[number]['key']

export default function DrawingsPage() {
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeKey>('all')
  const [modalImage, setModalImage] = useState<string | null>(null)

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

  // Close comparison modal on ESC
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
    } else if (drawing.drawing1Url) {
      setModalImage(getDriveThumbUrl(drawing.drawing1Url, 1200))
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
        <h1 className="text-2xl font-bold">📐 Drawings Library</h1>
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
        placeholder="Search by part number..."
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
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {filtered.map((drawing, i) => (
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
              <div className="h-[140px] bg-muted flex items-center justify-center relative">
                {drawing.drawing1Url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getDriveThumbUrl(drawing.drawing1Url, 300)}
                      alt={`Drawing for ${drawing.partNumber}`}
                      className="w-full h-full object-contain p-1"
                      onError={(e) => {
                        e.currentTarget.src = '/placeholder-drawing.svg'
                      }}
                    />
                    {drawing.drawing2Url && (
                      <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded">
                        +1
                      </span>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground text-xs text-center p-2">
                    No drawing
                  </div>
                )}
              </div>
              <CardContent className="p-2">
                <p className="font-semibold text-xs truncate">{drawing.partNumber}</p>
                <p className="text-[10px] text-muted-foreground truncate">{drawing.productType}</p>
              </CardContent>
            </Card>
          ))}
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

      {/* Image Modal (single) */}
      <ImageModal
        src={modalImage || ''}
        isOpen={!!modalImage}
        onClose={() => setModalImage(null)}
        alt="Drawing"
      />

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
            {selected.map((drawing, i) => (
              <div key={`compare-${drawing.partNumber}-${i}`} className="flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getDriveThumbUrl(drawing.drawing1Url || '', 1200)}
                  alt={drawing.partNumber}
                  className="max-h-[70vh] object-contain rounded-lg bg-white/5"
                />
                <p className="text-white font-semibold mt-2 text-sm">{drawing.partNumber}</p>
                <p className="text-white/60 text-xs">{drawing.productType}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
