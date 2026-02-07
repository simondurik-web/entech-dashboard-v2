'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { InventoryItem } from '@/lib/google-sheets'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low Stock', emoji: '⚠️' },
  { key: 'production', label: 'Needs Production', emoji: '🔧' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

function filterItems(items: InventoryItem[], filter: FilterKey, search: string): InventoryItem[] {
  let result = items
  switch (filter) {
    case 'low':
      result = result.filter((item) => item.minimum > 0 && item.inStock < item.minimum)
      break
    case 'production':
      result = result.filter((item) => item.minimum > 0 && item.inStock < item.minimum * 0.5)
      break
  }
  if (search.trim()) {
    const q = search.toLowerCase()
    result = result.filter(
      (item) =>
        item.partNumber.toLowerCase().includes(q) ||
        item.product.toLowerCase().includes(q)
    )
  }
  return result
}

function stockStatus(item: InventoryItem): 'ok' | 'low' | 'critical' {
  if (item.minimum <= 0) return 'ok'
  const pct = item.inStock / item.minimum
  if (pct < 0.5) return 'critical'
  if (pct < 1) return 'low'
  return 'ok'
}

function statusStyle(status: 'ok' | 'low' | 'critical') {
  switch (status) {
    case 'critical':
      return { border: 'border-l-red-500', badge: 'bg-red-500/20 text-red-600', label: 'CRITICAL', bar: 'bg-red-500', text: 'text-red-500' }
    case 'low':
      return { border: 'border-l-yellow-500', badge: 'bg-yellow-500/20 text-yellow-600', label: 'LOW', bar: 'bg-yellow-500', text: 'text-yellow-500' }
    default:
      return { border: 'border-l-green-500', badge: 'bg-green-500/20 text-green-600', label: 'OK', bar: 'bg-green-500', text: 'text-green-500' }
  }
}

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/inventory')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch inventory')
        return res.json()
      })
      .then((data) => setItems(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = filterItems(items, filter, search)

  return (
    <div className="p-4 pb-20">
      <h1 className="text-2xl font-bold mb-4">Inventory</h1>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by part number..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full p-3 mb-4 rounded-lg bg-muted border border-border"
      />

      {/* Filter chips */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in f ? `${f.emoji} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

      {/* Inventory list */}
      {!loading && !error && (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            {filtered.length} item{filtered.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-3">
            {filtered.map((item, i) => {
              const status = stockStatus(item)
              const style = statusStyle(status)
              const pct = item.minimum > 0 ? Math.round((item.inStock / item.minimum) * 100) : 100

              return (
                <Card key={`${item.partNumber}-${i}`} className={`border-l-4 ${style.border}`}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">{item.partNumber}</CardTitle>
                        <p className="text-sm text-muted-foreground">{item.product}</p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded ${style.badge}`}>
                        {style.label}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">In Stock</span>
                        <p className={`font-semibold ${style.text}`}>
                          {item.inStock.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Minimum</span>
                        <p className="font-semibold">{item.minimum.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Target</span>
                        <p className="font-semibold">{item.target > 0 ? item.target.toLocaleString() : '-'}</p>
                      </div>
                    </div>
                    {item.minimum > 0 && (
                      <div className="mt-2">
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${style.bar}`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {pct}% of minimum
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-10">
                No inventory items found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
