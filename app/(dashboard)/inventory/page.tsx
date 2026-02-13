'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { InventoryCard } from '@/components/cards/InventoryCard'
import type { InventoryItem } from '@/lib/google-sheets'

const STOCK_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low Stock', emoji: '⚠️' },
  { key: 'production', label: 'Needs Production', emoji: '🔧' },
] as const

const TYPE_FILTERS = [
  { key: 'manufactured', label: 'Manufactured', emoji: '🏭' },
  { key: 'purchased', label: 'Purchased', emoji: '🛒' },
  { key: 'com', label: 'COM', emoji: '📦' },
] as const

type StockFilterKey = (typeof STOCK_FILTERS)[number]['key']
type TypeFilterKey = (typeof TYPE_FILTERS)[number]['key']

function stockStatus(item: InventoryItem): 'ok' | 'low' | 'critical' {
  if (item.minimum <= 0) return 'ok'
  const pct = item.inStock / item.minimum
  if (pct < 0.5) return 'critical'
  if (pct < 1) return 'low'
  return 'ok'
}

function filterItems(
  items: InventoryItem[],
  stockFilter: StockFilterKey,
  typeFilters: Set<TypeFilterKey>,
  search: string
): InventoryItem[] {
  let result = items

  // Stock filter
  switch (stockFilter) {
    case 'low':
      result = result.filter((item) => item.minimum > 0 && item.inStock < item.minimum)
      break
    case 'production':
      result = result.filter((item) => item.minimum > 0 && item.inStock < item.minimum * 0.5)
      break
  }

  // Type filters (if any selected, only show those types)
  if (typeFilters.size > 0) {
    result = result.filter((item) => {
      const t = (item.itemType || '').toLowerCase()
      if (typeFilters.has('manufactured') && (t.includes('make') || t.includes('manufactured'))) return true
      if (typeFilters.has('purchased') && t.includes('purchased')) return true
      if (typeFilters.has('com') && t.includes('com')) return true
      return false
    })
  }

  // Search
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

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stockFilter, setStockFilter] = useState<StockFilterKey>('all')
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilterKey>>(new Set())
  const [search, setSearch] = useState('')

  const toggleTypeFilter = (key: TypeFilterKey) => {
    setTypeFilters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/inventory')
      if (!res.ok) throw new Error('Failed to fetch inventory')
      const data = await res.json()
      setItems(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filtered = filterItems(items, stockFilter, typeFilters, search)

  const totalItems = items.length
  const lowStock = items.filter((item) => stockStatus(item) === 'low').length
  const needsProduction = items.filter((item) => stockStatus(item) === 'critical').length
  const adequateStock = items.filter((item) => stockStatus(item) === 'ok' && item.minimum > 0).length

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">📦 Inventory</h1>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-muted-foreground text-sm mb-4">Inventory levels vs minimums</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-muted rounded-lg p-3">
          <p className="text-xs text-muted-foreground">Total Items</p>
          <p className="text-xl font-bold">{totalItems}</p>
        </div>
        <div className="bg-red-500/10 rounded-lg p-3">
          <p className="text-xs text-red-500">Needs Production</p>
          <p className="text-xl font-bold text-red-500">{needsProduction}</p>
        </div>
        <div className="bg-yellow-500/10 rounded-lg p-3">
          <p className="text-xs text-yellow-600">Low Stock</p>
          <p className="text-xl font-bold text-yellow-600">{lowStock}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-600">Adequate Stock</p>
          <p className="text-xl font-bold text-green-600">{adequateStock}</p>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by part number..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full p-3 mb-4 rounded-lg bg-muted border border-border"
      />

      {/* Stock filter chips */}
      <div className="flex gap-2 mb-2 overflow-x-auto pb-1">
        {STOCK_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStockFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors ${
              stockFilter === f.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
          >
            {'emoji' in f ? `${f.emoji} ` : ''}{f.label}
          </button>
        ))}
      </div>

      {/* Type filter chips (toggleable) */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => toggleTypeFilter(f.key)}
            className={`px-3 py-1 rounded-full text-sm whitespace-nowrap transition-colors border ${
              typeFilters.has(f.key)
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted hover:bg-muted/80 border-transparent'
            }`}
          >
            {f.emoji} {f.label}
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
            {filtered.map((item, i) => (
              <InventoryCard key={`${item.partNumber}-${i}`} item={item} index={i} />
            ))}
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
