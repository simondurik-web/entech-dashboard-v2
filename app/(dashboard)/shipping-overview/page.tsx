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

const DAY_OPTIONS = [1, 7, 10, 14, 30, 60, 90]

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
  return [order.customer, order.partNumber, order.ifNumber, order.line, order.poNumber].some((v) =>
    v.toLowerCase().includes(q),
  )
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
  return (
    <Suspense>
      <ShippingOverviewPageContent />
    </Suspense>
  )
}

function ShippingOverviewPageContent() {
  const [data, setData] = useState<ShippingOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-section search and category filters
  const [stagedSearch, setStagedSearch] = useState('')
  const [shippedSearch, setShippedSearch] = useState('')
  const [stagedCategories, setStagedCategories] = useState(DEFAULT_CATEGORIES)
  const [shippedCategories, setShippedCategories] = useState(DEFAULT_CATEGORIES)

  const [days, setDays] = useState(10)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [isLight, setIsLight] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('shipping-overview-theme') === 'light'
  })
  const [palletOpen, setPalletOpen] = useState(false)
  const mountedRef = useRef(true)

  // Toggle the global dark class so Tailwind dark: variants respond
  useEffect(() => {
    const html = document.documentElement
    if (isLight) {
      html.classList.remove('dark')
      html.style.colorScheme = 'light'
    } else {
      html.classList.add('dark')
      html.style.colorScheme = 'dark'
    }
    return () => {
      html.classList.add('dark')
      html.style.colorScheme = 'dark'
    }
  }, [isLight])

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
    () => filterByCategory((data?.staged ?? []).filter((o) => matchesSearch(o, stagedSearch)), stagedCategories),
    [data?.staged, stagedSearch, stagedCategories],
  )
  const shipped = useMemo(
    () => filterByCategory((data?.shipped ?? []).filter((o) => matchesSearch(o, shippedSearch)), shippedCategories),
    [data?.shipped, shippedSearch, shippedCategories],
  )

  const stagedOrdersForCalc = useMemo(() => (data?.staged ?? []).map(mapToOrder), [data?.staged])

  // ── Conditional classes ──────────────────────────────────
  const pageBg = isLight
    ? 'bg-[#f5f7fa]'
    : 'bg-[radial-gradient(circle_at_top,_rgba(42,82,152,0.18),_transparent_45%),linear-gradient(180deg,_rgba(2,6,23,0.96),_transparent)]'

  const sectionBg = isLight
    ? 'bg-white border-[#e1e8ed] shadow-[0_2px_12px_rgba(0,0,0,0.08)]'
    : 'bg-background/90 border-border/70 shadow-sm backdrop-blur'

  const sectionTitleStaged = isLight ? 'text-[#1e3c72]' : 'text-blue-400'
  const sectionTitleShipped = isLight ? 'text-[#27ae60]' : 'text-emerald-400'
  const summaryValueStaged = isLight ? 'text-[#1e3c72]' : 'text-foreground'
  const summaryValueShipped = isLight ? 'text-[#27ae60]' : 'text-foreground'
  const summaryLabel = isLight ? 'text-[#7f8c8d]' : 'text-muted-foreground'
  const summaryBorder = isLight ? 'border-[#e1e8ed]' : 'border-border/50'

  const searchInputBg = isLight
    ? 'bg-white border-[#ddd] focus:border-[#2a5298] focus:ring-[#2a5298]/10'
    : 'bg-background'

  const dayPillActive = isLight
    ? 'border-[#27ae60] bg-[#27ae60] text-white'
    : 'border-emerald-500 bg-emerald-500 text-white'
  const dayPillInactive = isLight
    ? 'border-[#e1e8ed] bg-white text-[#7f8c8d] hover:bg-[#f5f7fa]'
    : 'border-border/50 bg-muted/30 text-muted-foreground hover:bg-muted/50'

  return (
    <div className={`min-h-screen p-4 pb-20 ${pageBg}`}>
      {/* ── Header ─────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#1e3c72_0%,#2a5298_100%)] px-6 py-4 text-white shadow-[0_18px_60px_rgba(30,60,114,0.28)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Shipping Dashboard</h1>
              <p className="text-sm uppercase tracking-[0.24em] text-white/75">
                {formatHeaderDate(data?.generatedAt ?? new Date().toISOString())}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start">
              <button
                type="button"
                onClick={() => setPalletOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm transition hover:bg-white/15"
              >
                <span>📦</span>
                <span>Pallet Calculator</span>
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm transition hover:bg-white/15"
                aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
              >
                {isLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
                <span>{isLight ? 'Dark' : 'Light'}</span>
              </button>
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
            stats={
              data?.stats ?? {
                stagedOrders: 0,
                stagedRevenue: 0,
                stagedUnits: 0,
                shippedOrders: 0,
                shippedRevenue: 0,
                shippedUnits: 0,
                totalRevenue: 0,
                totalUnits: 0,
              }
            }
            days={days}
          />
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
        <div className="mt-4 grid grid-cols-1 gap-4 min-[1400px]:grid-cols-2 min-[1400px]:h-[calc(100vh-210px)]">
          {/* ═══ Left: Ready to Ship ═══ */}
          <div className={`overflow-hidden rounded-3xl border flex flex-col ${sectionBg}`}>
            {/* Section header */}
            <div className={`shrink-0 border-b px-6 py-5 ${summaryBorder}`}>
              <h2 className={`text-2xl font-bold ${sectionTitleStaged}`}>📦 Ready to Ship</h2>
              <p className={`mt-1 text-xs ${summaryLabel}`}>{staged.length} orders</p>

              {/* Search bar */}
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#95a5a6]" />
                <Input
                  value={stagedSearch}
                  onChange={(e) => setStagedSearch(e.target.value)}
                  placeholder="🔍 Search orders..."
                  className={`h-10 rounded-lg pl-10 text-sm ${searchInputBg}`}
                />
              </div>

              {/* Category filter */}
              <div className="mt-3">
                <CategoryFilter value={stagedCategories} onChange={setStagedCategories} />
              </div>
            </div>

            {/* Summary stats */}
            <div className={`shrink-0 grid grid-cols-2 border-b ${summaryBorder}`}>
              <div className={`border-r p-5 text-center ${summaryBorder}`}>
                <div className={`text-2xl font-extrabold ${summaryValueStaged}`}>
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                    staged.reduce((sum, o) => sum + o.revenue, 0),
                  )}
                </div>
                <div className={`mt-1 text-xs font-semibold uppercase tracking-wider ${summaryLabel}`}>Total Revenue</div>
              </div>
              <div className="p-5 text-center">
                <div className={`text-2xl font-extrabold ${summaryValueStaged}`}>
                  {new Intl.NumberFormat('en-US').format(staged.reduce((sum, o) => sum + o.orderQty, 0))}
                </div>
                <div className={`mt-1 text-xs font-semibold uppercase tracking-wider ${summaryLabel}`}>Total Units</div>
              </div>
            </div>

            {/* Scrollable order list */}
            <div data-lenis-prevent className="max-h-[60vh] min-[1400px]:max-h-none flex-1 min-h-0 overflow-y-auto p-5">
              <OrderList
                orders={staged}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((c) => (c === key ? null : key))}
                emptyMessage="No staged orders match the current filter."
              />
            </div>
          </div>

          {/* ═══ Right: Shipped ═══ */}
          <div className={`overflow-hidden rounded-3xl border flex flex-col ${sectionBg}`}>
            {/* Section header */}
            <div className={`shrink-0 border-b px-6 py-5 ${summaryBorder}`}>
              <div className="flex items-center gap-3">
                <h2 className={`text-2xl font-bold ${sectionTitleShipped}`}>🚚 Shipped (Last {days} Days)</h2>
              </div>
              <p className={`mt-1 text-xs ${summaryLabel}`}>{shipped.length} orders</p>

              {/* Search bar */}
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#95a5a6]" />
                <Input
                  value={shippedSearch}
                  onChange={(e) => setShippedSearch(e.target.value)}
                  placeholder="🔍 Search orders..."
                  className={`h-10 rounded-lg pl-10 text-sm ${searchInputBg}`}
                />
              </div>

              {/* Category filter */}
              <div className="mt-3">
                <CategoryFilter value={shippedCategories} onChange={setShippedCategories} />
              </div>

              {/* Day slicer */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {DAY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDayChange(d)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${days === d ? dayPillActive : dayPillInactive}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {/* Summary stats */}
            <div className={`shrink-0 grid grid-cols-2 border-b ${summaryBorder}`}>
              <div className={`border-r p-5 text-center ${summaryBorder}`}>
                <div className={`text-2xl font-extrabold ${summaryValueShipped}`}>
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
                    shipped.reduce((sum, o) => sum + o.revenue, 0),
                  )}
                </div>
                <div className={`mt-1 text-xs font-semibold uppercase tracking-wider ${summaryLabel}`}>Total Revenue</div>
              </div>
              <div className="p-5 text-center">
                <div className={`text-2xl font-extrabold ${summaryValueShipped}`}>
                  {new Intl.NumberFormat('en-US').format(shipped.reduce((sum, o) => sum + o.orderQty, 0))}
                </div>
                <div className={`mt-1 text-xs font-semibold uppercase tracking-wider ${summaryLabel}`}>Total Units</div>
              </div>
            </div>

            {/* Scrollable order list */}
            <div data-lenis-prevent className="max-h-[60vh] min-[1400px]:max-h-none flex-1 min-h-0 overflow-y-auto p-5">
              <OrderList
                orders={shipped}
                expandedKey={expandedKey}
                onToggle={(key) => setExpandedKey((c) => (c === key ? null : key))}
                emptyMessage={`No shipped orders from the last ${days} days match the current filter.`}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Pallet Calculator Dialog ────────────────────────── */}
      <Dialog open={palletOpen} onOpenChange={setPalletOpen}>
        <DialogContent className="flex flex-col max-h-[92vh] max-w-[95vw] xl:max-w-7xl p-0 gap-0">
          <DialogHeader className="shrink-0 px-6 py-4 border-b">
            <DialogTitle>📦 Pallet Load Calculator</DialogTitle>
          </DialogHeader>
          <div data-lenis-prevent className="flex-1 min-h-0 overflow-y-auto p-6">
            <PalletLoadCalculator stagedOrders={stagedOrdersForCalc} />
          </div>
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
