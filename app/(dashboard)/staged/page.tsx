'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { OrderDetail } from '@/components/OrderDetail'
import type { Order } from '@/lib/google-sheets'
import { normalizeStatus } from '@/lib/google-sheets'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'rolltech', label: 'Roll Tech', emoji: '🔵' },
  { key: 'molding', label: 'Molding', emoji: '🟡' },
  { key: 'snappad', label: 'Snap Pad', emoji: '🟣' },
] as const

type FilterKey = (typeof FILTERS)[number]['key']

function filterOrders(orders: Order[], filter: FilterKey, search: string): Order[] {
  let result = orders
  switch (filter) {
    case 'rolltech':
      result = result.filter((o) => o.category.toLowerCase().includes('roll'))
      break
    case 'molding':
      result = result.filter((o) => o.category.toLowerCase().includes('molding'))
      break
    case 'snappad':
      result = result.filter((o) => o.category.toLowerCase().includes('snap'))
      break
  }
  if (search.trim()) {
    const q = search.toLowerCase()
    result = result.filter(
      (o) =>
        o.customer.toLowerCase().includes(q) ||
        o.partNumber.toLowerCase().includes(q) ||
        o.ifNumber.toLowerCase().includes(q) ||
        o.line.toLowerCase().includes(q)
    )
  }
  return result
}

export default function StagedPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')
  const [expandedOrderKey, setExpandedOrderKey] = useState<string | null>(null)

  const getOrderKey = (order: Order): string => `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`

  const toggleExpanded = (order: Order) => {
    const key = getOrderKey(order)
    setExpandedOrderKey((prev) => (prev === key ? null : key))
  }

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    
    try {
      const res = await fetch('/api/sheets')
      if (!res.ok) throw new Error('Failed to fetch orders')
      const data: Order[] = await res.json()
      const staged = data.filter(
        (o) => normalizeStatus(o.internalStatus, o.ifStatus) === 'staged'
      )
      setOrders(staged)
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

  const filtered = filterOrders(orders, filter, search)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Staged Orders</h1>
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          className="p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search staged orders..."
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

      {/* Staged list */}
      {!loading && !error && (
        <>
          <p className="text-sm text-muted-foreground mb-3">
            {filtered.length} staged order{filtered.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-3">
            {filtered.map((order, i) => {
              const isExpanded = expandedOrderKey === getOrderKey(order)
              return (
                <Card 
                  key={`${order.ifNumber}-${i}`} 
                  className={`border-l-4 border-l-emerald-500 cursor-pointer transition-colors ${isExpanded ? 'bg-muted/20' : ''}`}
                  onClick={() => toggleExpanded(order)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="text-lg">{order.customer}</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          Line {order.line} &middot; {order.partNumber}
                        </p>
                      </div>
                      <span className="px-2 py-1 bg-emerald-500/20 text-emerald-600 text-xs rounded">
                        STAGED
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Qty</span>
                        <p className="font-semibold">{order.orderQty.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">IF #</span>
                        <p className="font-semibold text-xs">{order.ifNumber || '-'}</p>
                      </div>
                    </div>
                    {/* Expandable content */}
                    <div
                      className={`grid transition-all duration-300 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}
                    >
                      <div className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        {isExpanded && (
                          <OrderDetail
                            ifNumber={order.ifNumber}
                            line={order.line}
                            isShipped={false}
                            partNumber={order.partNumber}
                            tirePartNum={order.tire}
                            hubPartNum={order.hub}
                            onClose={() => setExpandedOrderKey(null)}
                          />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-10">
                No staged orders found
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
