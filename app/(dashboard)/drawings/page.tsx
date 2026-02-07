'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ImageModal } from '@/components/ImageModal'
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

  const filtered = drawings.filter((d) => {
    // Type filter
    if (typeFilter !== 'all' && d.productType !== typeFilter) return false
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!d.partNumber.toLowerCase().includes(q) && !d.product.toLowerCase().includes(q)) {
        return false
      }
    }
    return true
  })

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-2">📐 Drawings Library</h1>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((drawing, i) => (
            <Card key={`${drawing.partNumber}-${i}`} className="overflow-hidden">
              <div
                className="aspect-square bg-muted flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity relative"
                onClick={() => drawing.drawing1Url && setModalImage(drawing.drawing1Url)}
              >
                {drawing.drawing1Url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={drawing.drawing1Url}
                      alt={`Drawing for ${drawing.partNumber}`}
                      className="w-full h-full object-contain p-2"
                      onError={(e) => {
                        // Fallback to placeholder on error
                        e.currentTarget.src = '/placeholder-drawing.svg'
                      }}
                    />
                    {drawing.drawing2Url && (
                      <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">
                        +1
                      </span>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground text-sm text-center p-4">
                    No drawing available
                  </div>
                )}
              </div>
              <CardContent className="p-3">
                <p className="font-semibold text-sm truncate">{drawing.partNumber}</p>
                <p className="text-xs text-muted-foreground truncate">{drawing.product}</p>
                <span
                  className={`inline-block mt-1 px-2 py-0.5 text-xs rounded ${
                    drawing.productType === 'Tire'
                      ? 'bg-orange-500/20 text-orange-600'
                      : drawing.productType === 'Hub'
                      ? 'bg-teal-500/20 text-teal-600'
                      : 'bg-gray-500/20 text-gray-600'
                  }`}
                >
                  {drawing.productType}
                </span>
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

      {/* Image Modal */}
      <ImageModal
        src={modalImage || ''}
        isOpen={!!modalImage}
        onClose={() => setModalImage(null)}
        alt="Drawing"
      />
    </div>
  )
}
