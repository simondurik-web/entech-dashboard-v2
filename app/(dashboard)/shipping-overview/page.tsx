'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Moon, RefreshCw, Search, Ship, Sun } from 'lucide-react'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ShippingOverviewCard } from '@/components/shipping-overview/ShippingOverviewCard'
import { ShippingStats } from '@/components/shipping-overview/ShippingStats'
import { CategoryFilter, filterByCategory, DEFAULT_CATEGORIES } from '@/components/category-filter'
import PalletLoadCalculator from '@/components/PalletLoadCalculator'
import type { ShippingOverviewOrder, ShippingOverviewResponse } from '@/components/shipping-overview/types'
import type { Order } from '@/lib/google-sheets-shared'

const DAY_OPTIONS = [7, 10, 14, 30, 60, 90]

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

function mapToOrder(o: ShippingOverviewOrder): Order {
  return {
    line: o.line,
    category: o.category,
    dateOfRequest: '',
    priorityLevel: 0,
    urgentOverride: false,
    ifNumber: o.ifNumber,
    ifStatus: '',
    internalStatus: 'staged',
    poNumber: o.poNumber,
    customer: o.customer,
    partNumber: o.partNumber,
    orderQty: o.orderQty,
    packaging: '',
    partsPerPackage: 0,
    numPackages: 0,
    fusionInventory: 0,
    hubMold: '',
    tire: '',
    hasTire: false,
    hub: '',
    hasHub: false,
    bearings: '',
    requestedDate: o.requestedDate,
    daysUntilDue: o.daysUntilDue,
    assignedTo: '',
    shippedDate: o.shippedDate,
    dailyCapacity: 0,
    priorityOverride: null,
    priorityChangedBy: null,
    priorityChangedAt: null,
  }
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
  const [days, setDays] = useState(10)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [isLight, setIsLight] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('shipping-overview-theme') === 'light'
  })
  const [palletOpen, setPalletOpen] = useState(false)
  const mountedRef = useRef(true)

  function toggleTheme() {
    setIsLight((prev) => {
      const next = !prev
      localStorage.setItem('shipping-overview-theme', next ? 'light' : 'dark')
      return next
    })
  }

  const load = useCallback(async (selectedDays: number, isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/shipping-overview?days=${selectedDays}`)
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
    void load(days)
    const interval = window.setInterval(() => {
      if (mountedRef.current) void load(days, true)
    }, 5 * 60 * 1000)
    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  function handleDayChange(d: number) {
    setDays(d)
    void load(d)
  }

  const staged = useMemo(
    () => filterByCategory((data?.staged ?? []).filter((o) => matchesSearch(o, search)), categories),
    [data?.staged, search, categories],
  )
  const shipped = useMemo(
    () => filterByCategory((data?.shipped ?? []).filter((o) => matchesSearch(o, search)), categories),
    [data?.shipped, search, categories],
  )

  const stagedOrdersForCalc = useMemo(() => (data?.staged ?? []).map(mapToOrder), [data?.staged])

  // ── Light theme conditional classes ──────────────────────
  const pageBg = isLight
    ? 'bg-[#f5f7fa]'
    : 'bg-[radial-gradient(circle_at_top,_rgba(42,82,152,0.18),_transparent_45%),linear-gradient(180deg,_rgba(2,6,23,0.96),_transparent)]'

  const panelBase = isLight
    ? 'rounded-3xl border border-[#e1e8ed] bg-white shadow-sm'
    : 'rounded-3xl border border-border/70 bg-background/90 shadow-sm backdrop-blur'

  const columnHeaderStaged = isLight ? 'text-[#1e3c72]' : 'text-blue-400'
  const columnHeaderShipped = isLight ? 'text-[#27ae60]' : 'text-emerald-400'

  const columnBg = isLight
    ? 'rounded-2xl border border-[#e1e8ed] bg-white'
    : 'rounded-2xl border border-border/50 bg-muted/20'

  const searchBg = isLight ? 'bg-[#f5f7fa]' : 'bg-background'

  return (
    <div className={`min-h-screen p-4 pb-20 ${pageBg}`}>
      {/* ── Header ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#1e3c72_0%,#2a5298_100%)] px-6 py-8 text-white shadow-[0_18px_60px_rgba(30,60,114,0.28)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">Shipping Dashboard</h1>
              <p className="text-sm uppercase tracking-[0.24em] text-white/75">
                {formatHeaderDate(data?.generatedAt ?? new Date().toISOString())}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              {/* Pallet Calculator button */}
              <button
                type="button"
                onClick={() => setPalletOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm transition hover:bg-white/15"
              >
                <span>📦</span>
                <span>Pallet Calculator</span>
              </button>

              {/* Theme toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm transition hover:bg-white/15"
                aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
              >
                {isLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
                <span>{isLight ? 'Dark' : 'Light'}</span>
              </button>

              {/* Refresh */}
              <button
                type="button"
                onClick={() => void load(days, true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm transition hover:bg-white/15"
              >
                <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <ShippingStats
            stats={data?.stats ?? {
              stagedOrders: 0, stagedRevenue: 0, stagedUnits: 0,
              shippedOrders: 0, shippedRevenue: 0, shippedUnits: 0,
              totalRevenue: 0, totalUnits: 0,
            }}
            days={days}
          />
        </div>
      </section>

      {/* ── Search + Category filter ────────────────────────── */}
      <section className={`mt-5 p-4 md:p-5 ${panelBase}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer, part #, IF#, line #, or PO #"
              className={`h-11 rounded-xl pl-10 ${searchBg}`}
            />
          </div>
          <CategoryFilter value={categories} onChange={setCategories} />
        </div>
      </section>

      {/* ── Loading / Error ─────────────────────────────────── */}
      {loading && (
        <div className="mt-5">
          <TableSkeleton rows={8} />
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── Two-column grid ─────────────────────────────────── */}
      {!loading && !error && data && (
        <div className="mt-5 grid grid-cols-1 gap-5 min-[1400px]:grid-cols-2">
          {/* Left: Ready to Ship */}
          <div className={`flex flex-col gap-3 p-4 md:p-5 ${panelBase}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-lg font-bold ${columnHeaderStaged}`}>
                📋 Ready to Ship
              </h2>
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${isLight ? 'bg-[#e8eef8] text-[#1e3c72]' : 'bg-blue-500/20 text-blue-400'}`}>
                {staged.length}
              </span>
            </div>
            <div className={`max-h-[80vh] overflow-y-auto rounded-xl ${columnBg} p-3`}>
              <OrderList
                orders={staged}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((current) => (current === key ? null : key))}
                emptyMessage="No staged orders match the current filter."
              />
            </div>
          </div>

          {/* Right: Shipped */}
          <div className={`flex flex-col gap-3 p-4 md:p-5 ${panelBase}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-lg font-bold ${columnHeaderShipped}`}>
                🚚 Shipped
              </h2>
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${isLight ? 'bg-[#e8f5e9] text-[#27ae60]' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {shipped.length}
              </span>
            </div>

            {/* Day slicer */}
            <div className="flex flex-wrap gap-1.5">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handleDayChange(d)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    days === d
                      ? isLight
                        ? 'border-[#27ae60] bg-[#27ae60] text-white'
                        : 'border-emerald-500 bg-emerald-500 text-white'
                      : isLight
                        ? 'border-[#e1e8ed] bg-white text-[#7f8c8d] hover:bg-[#f5f7fa]'
                        : 'border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <div className={`max-h-[80vh] overflow-y-auto rounded-xl ${columnBg} p-3`}>
              <OrderList
                orders={shipped}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((current) => (current === key ? null : key))}
                emptyMessage={`No shipped orders from the last ${days} days match the current filter.`}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Pallet Calculator Dialog ────────────────────────── */}
      <Dialog open={palletOpen} onOpenChange={setPalletOpen}>
        <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto xl:max-w-7xl">
          <DialogHeader>
            <DialogTitle>📦 Pallet Load Calculator</DialogTitle>
          </DialogHeader>
          <PalletLoadCalculator stagedOrders={stagedOrdersForCalc} />
        </DialogContent>
      </Dialog>
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
