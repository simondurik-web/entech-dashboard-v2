'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Search, Ship } from 'lucide-react'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { ShippingOverviewCard } from '@/components/shipping-overview/ShippingOverviewCard'
import { ShippingStats } from '@/components/shipping-overview/ShippingStats'
import type { ShippingOverviewOrder, ShippingOverviewResponse } from '@/components/shipping-overview/types'

function formatHeaderDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Live now'
  return date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function matchesSearch(order: ShippingOverviewOrder, query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  return [
    order.customer,
    order.partNumber,
    order.ifNumber,
    order.line,
    order.poNumber,
  ].some((value) => value.toLowerCase().includes(q))
}

export default function ShippingOverviewPage() {
  return <Suspense><ShippingOverviewPageContent /></Suspense>
}

function ShippingOverviewPageContent() {
  const [data, setData] = useState<ShippingOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'staged' | 'shipped'>('staged')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/shipping-overview')
      if (!response.ok) throw new Error('Failed to fetch shipping overview')
      const json: ShippingOverviewResponse = await response.json()
      if (mountedRef.current) setData(json)
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Failed to fetch shipping overview')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true

    void load()
    const interval = window.setInterval(() => {
      if (mountedRef.current) void load(true)
    }, 5 * 60 * 1000)

    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
    }
  }, [load])

  const staged = useMemo(() => (data?.staged ?? []).filter((order) => matchesSearch(order, search)), [data?.staged, search])
  const shipped = useMemo(() => (data?.shipped ?? []).filter((order) => matchesSearch(order, search)), [data?.shipped, search])

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(42,82,152,0.08),_transparent_40%),linear-gradient(180deg,_rgba(248,250,252,0.92),_transparent)] p-4 pb-20 dark:bg-[radial-gradient(circle_at_top,_rgba(42,82,152,0.18),_transparent_45%),linear-gradient(180deg,_rgba(2,6,23,0.96),_transparent)]">
      <section className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#1e3c72_0%,#2a5298_100%)] px-6 py-8 text-white shadow-[0_18px_60px_rgba(30,60,114,0.28)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Shipping Dashboard</h1>
              <p className="text-sm uppercase tracking-[0.24em] text-white/75">
                {formatHeaderDate(data?.generatedAt ?? new Date().toISOString())}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm transition hover:bg-white/15"
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>

          <ShippingStats
            stats={data?.stats ?? { stagedOrders: 0, shippedOrders: 0, totalRevenue: 0, totalUnits: 0 }}
          />
        </div>
      </section>

      <section className="mt-5 rounded-3xl border border-border/70 bg-background/90 p-4 shadow-sm backdrop-blur md:p-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer, part #, IF#, line #, or PO #"
            className="h-11 rounded-xl bg-background pl-10"
          />
        </div>

        {loading && (
          <div className="mt-4">
            <TableSkeleton rows={8} />
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'staged' | 'shipped')} className="mt-4">
            <TabsList className="h-auto w-full flex-wrap gap-2 rounded-2xl bg-muted/70 p-2">
              <TabsTrigger value="staged" className="min-h-11 flex-1 rounded-xl text-sm font-semibold">
                <span className="mr-1">📋</span>
                <span>Staged Orders ({staged.length})</span>
              </TabsTrigger>
              <TabsTrigger value="shipped" className="min-h-11 flex-1 rounded-xl text-sm font-semibold">
                <span className="mr-1">🚚</span>
                <span>Shipped Orders - Last 10 Days ({shipped.length})</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="staged" className="mt-5">
              <OrderList
                orders={staged}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((current) => (current === key ? null : key))}
                emptyMessage="No staged orders match the current filter."
              />
            </TabsContent>

            <TabsContent value="shipped" className="mt-5">
              <OrderList
                orders={shipped}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((current) => (current === key ? null : key))}
                emptyMessage="No shipped orders from the last 10 days match the current filter."
              />
            </TabsContent>
          </Tabs>
        )}
      </section>
    </div>
  )
}

function OrderList({
  orders,
  expandedKey,
  onToggle,
  emptyMessage,
}: {
  orders: ShippingOverviewOrder[]
  expandedKey: string | null
  onToggle: (key: string) => void
  emptyMessage: string
}) {
  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
        <Ship className="mx-auto mb-3 size-5" />
        <p>{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => {
        const key = `${order.ifNumber || 'no-if'}::${order.line || 'no-line'}`
        return (
          <ShippingOverviewCard
            key={key}
            order={order}
            expanded={expandedKey === key}
            onToggle={() => onToggle(key)}
          />
        )
      })}
    </div>
  )
}
