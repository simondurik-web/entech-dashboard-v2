'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { X, ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SalesOrder {
  line: string
  customer: string
  partNumber: string
  category: string
  qty: number
  revenue: number
  totalCost: number
  totalProfit: number
  totalMarginPct: number
  variableMarginPct: number
  shippedDate: string
  status: string
}

interface CustomerData {
  customer: string
  revenue: number
  totalMarginPct: number
  orders: SalesOrder[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerData[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}

function fmtFull(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function getMarginColor(margin: number): string {
  if (margin >= 30) return 'rgba(16,185,129,0.85)'
  if (margin >= 20) return 'rgba(16,185,129,0.70)'
  if (margin >= 10) return 'rgba(16,185,129,0.50)'
  if (margin >= 0) return 'rgba(16,185,129,0.30)'
  if (margin >= -10) return 'rgba(239,68,68,0.40)'
  return 'rgba(239,68,68,0.70)'
}

function getMarginTextColor(margin: number): string {
  if (margin >= 10) return 'rgba(255,255,255,0.95)'
  if (margin >= 0) return 'rgba(255,255,255,0.85)'
  return 'rgba(255,255,255,0.95)'
}

// ─── Treemap layout (squarified) ─────────────────────────────────────────────

interface TreemapRect {
  x: number
  y: number
  w: number
  h: number
  value: number
  index: number
}

function squarify(
  items: { value: number; index: number }[],
  x: number, y: number, w: number, h: number
): TreemapRect[] {
  if (items.length === 0) return []
  if (items.length === 1) {
    return [{ ...items[0], x, y, w, h }]
  }

  const total = items.reduce((s, i) => s + i.value, 0)
  if (total <= 0) return []

  // Sort descending by value
  const sorted = [...items].sort((a, b) => b.value - a.value)

  const rects: TreemapRect[] = []
  layoutStrip(sorted, x, y, w, h, total, rects)
  return rects
}

function layoutStrip(
  items: { value: number; index: number }[],
  x: number, y: number, w: number, h: number,
  total: number,
  out: TreemapRect[]
) {
  if (items.length === 0 || total <= 0) return

  if (items.length === 1) {
    out.push({ ...items[0], x, y, w, h })
    return
  }

  // Use slice-and-dice for simplicity + readability (alternating horizontal/vertical)
  const isHorizontal = w >= h

  let runningSum = 0
  for (const item of items) {
    const fraction = item.value / total
    if (isHorizontal) {
      const cellW = w * fraction
      out.push({ ...item, x: x + runningSum, y, w: cellW, h })
      runningSum += cellW
    } else {
      const cellH = h * fraction
      out.push({ ...item, x, y: y + runningSum, w, h: cellH })
      runningSum += cellH
    }
  }
}

// ─── Minimum size enforcement ────────────────────────────────────────────────

const MIN_CELL_WIDTH = 120
const MIN_CELL_HEIGHT = 60
const CELL_GAP = 3

// ─── Component ───────────────────────────────────────────────────────────────

export function RevenueConcentrationModal({ open, onOpenChange, customers }: Props) {
  const [drillCustomer, setDrillCustomer] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })

  // Measure container
  useEffect(() => {
    if (!open || !containerRef.current) return
    const el = containerRef.current
    const measure = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  // Reset drill-down when closing
  useEffect(() => {
    if (!open) {
      setDrillCustomer(null)
      setSelectedOrder(null)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedOrder) setSelectedOrder(null)
        else if (drillCustomer) setDrillCustomer(null)
        else onOpenChange(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, drillCustomer, selectedOrder, onOpenChange])

  // ─── Data ────────────────────────────────────────────────────────────

  const sortedCustomers = useMemo(
    () => [...customers].filter(c => c.revenue > 0).sort((a, b) => b.revenue - a.revenue),
    [customers]
  )

  const drilledCustomer = useMemo(
    () => drillCustomer ? sortedCustomers.find(c => c.customer === drillCustomer) : null,
    [drillCustomer, sortedCustomers]
  )

  const drilledOrders = useMemo(
    () => drilledCustomer
      ? [...drilledCustomer.orders].filter(o => o.revenue > 0).sort((a, b) => b.revenue - a.revenue)
      : [],
    [drilledCustomer]
  )

  // ─── Treemap rects ──────────────────────────────────────────────────

  const customerRects = useMemo(() => {
    if (containerSize.w === 0) return []
    const items = sortedCustomers.map((c, i) => ({ value: c.revenue, index: i }))
    return squarify(items, 0, 0, containerSize.w, containerSize.h)
  }, [sortedCustomers, containerSize])

  const orderRects = useMemo(() => {
    if (containerSize.w === 0 || !drilledCustomer) return []
    const items = drilledOrders.map((o, i) => ({ value: o.revenue, index: i }))
    return squarify(items, 0, 0, containerSize.w, containerSize.h)
  }, [drilledOrders, drilledCustomer, containerSize])

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleCustomerClick = useCallback((customer: string) => {
    setDrillCustomer(customer)
    setSelectedOrder(null)
  }, [])

  const handleOrderClick = useCallback((order: SalesOrder) => {
    setSelectedOrder(order)
  }, [])

  const handleBack = useCallback(() => {
    if (selectedOrder) {
      setSelectedOrder(null)
    } else {
      setDrillCustomer(null)
    }
  }, [selectedOrder])

  // ─── Render ──────────────────────────────────────────────────────────

  if (!open) return null

  const totalRevenue = sortedCustomers.reduce((s, c) => s + c.revenue, 0)

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          {drillCustomer && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
          )}
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              Revenue Concentration
              {drillCustomer && (
                <>
                  <ChevronRight className="size-4 text-muted-foreground" />
                  <span className="text-primary">{drillCustomer}</span>
                </>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {drillCustomer
                ? `${drilledOrders.length} orders · ${fmt(drilledCustomer?.revenue || 0)} revenue`
                : `${sortedCustomers.length} customers · ${fmt(totalRevenue)} total revenue`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.7)' }} />
              High margin (20%+)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(16,185,129,0.35)' }} />
              Low margin
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(239,68,68,0.6)' }} />
              Negative
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </Button>
        </div>
      </div>

      {/* Treemap area */}
      <div className="flex-1 min-h-0 flex">
        <div ref={containerRef} className="flex-1 relative overflow-auto p-3">
          {!drillCustomer ? (
            /* ─── Customer-level treemap ─── */
            <div className="relative" style={{ width: containerSize.w || '100%', height: containerSize.h || '100%' }}>
              {customerRects.map((rect) => {
                const c = sortedCustomers[rect.index]
                if (!c) return null
                const cellW = Math.max(rect.w - CELL_GAP * 2, MIN_CELL_WIDTH)
                const cellH = Math.max(rect.h - CELL_GAP * 2, MIN_CELL_HEIGHT)
                const pct = totalRevenue > 0 ? ((c.revenue / totalRevenue) * 100).toFixed(1) : '0'

                return (
                  <div
                    key={c.customer}
                    className="absolute rounded-lg cursor-pointer transition-all duration-150 hover:brightness-125 hover:ring-2 hover:ring-white/20 active:scale-[0.98] flex flex-col items-center justify-center text-center p-2 overflow-hidden"
                    style={{
                      left: rect.x + CELL_GAP,
                      top: rect.y + CELL_GAP,
                      width: cellW,
                      height: cellH,
                      background: getMarginColor(c.totalMarginPct),
                      color: getMarginTextColor(c.totalMarginPct),
                      minWidth: MIN_CELL_WIDTH,
                      minHeight: MIN_CELL_HEIGHT,
                    }}
                    onClick={() => handleCustomerClick(c.customer)}
                    title={`${c.customer}\nRevenue: ${fmt(c.revenue)}\nMargin: ${c.totalMarginPct.toFixed(1)}%\nOrders: ${c.orders.length}`}
                  >
                    <span className="font-semibold text-xs leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                      {c.customer}
                    </span>
                    <span className="text-[11px] opacity-80 mt-0.5">{fmt(c.revenue)}</span>
                    <span className="text-[10px] opacity-60">{pct}% · {c.totalMarginPct.toFixed(1)}% margin</span>
                  </div>
                )
              })}
            </div>
          ) : (
            /* ─── Order-level treemap (drilled into customer) ─── */
            <div className="relative" style={{ width: containerSize.w || '100%', height: containerSize.h || '100%' }}>
              {orderRects.length === 0 && (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No orders with positive revenue
                </div>
              )}
              {orderRects.map((rect) => {
                const o = drilledOrders[rect.index]
                if (!o) return null
                const cellW = Math.max(rect.w - CELL_GAP * 2, MIN_CELL_WIDTH)
                const cellH = Math.max(rect.h - CELL_GAP * 2, MIN_CELL_HEIGHT)
                const isSelected = selectedOrder?.line === o.line

                return (
                  <div
                    key={o.line}
                    className={`absolute rounded-lg cursor-pointer transition-all duration-150 hover:brightness-125 flex flex-col items-center justify-center text-center p-2 overflow-hidden ${
                      isSelected ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : 'hover:ring-2 hover:ring-white/20'
                    }`}
                    style={{
                      left: rect.x + CELL_GAP,
                      top: rect.y + CELL_GAP,
                      width: cellW,
                      height: cellH,
                      background: getMarginColor(o.totalMarginPct),
                      color: getMarginTextColor(o.totalMarginPct),
                      minWidth: MIN_CELL_WIDTH,
                      minHeight: MIN_CELL_HEIGHT,
                    }}
                    onClick={() => handleOrderClick(o)}
                  >
                    <span className="font-semibold text-xs leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full">
                      {o.partNumber}
                    </span>
                    <span className="text-[11px] opacity-80 mt-0.5">{fmt(o.revenue)}</span>
                    <span className="text-[10px] opacity-60">Line {o.line} · {o.totalMarginPct.toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Order detail panel (right side) */}
        {selectedOrder && (
          <div className="w-80 border-l border-white/[0.06] p-5 shrink-0 overflow-y-auto bg-white/[0.02] animate-in slide-in-from-right-4 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Order Details</h3>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => setSelectedOrder(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>

            <div className="space-y-3 text-sm">
              <DetailRow label="Line" value={selectedOrder.line} />
              <DetailRow label="Part Number" value={selectedOrder.partNumber} />
              <DetailRow label="Category" value={selectedOrder.category} />
              <DetailRow label="Quantity" value={selectedOrder.qty.toLocaleString()} />
              <DetailRow label="Revenue" value={fmtFull(selectedOrder.revenue)} />
              <DetailRow label="Total Cost" value={fmtFull(selectedOrder.totalCost)} />
              <DetailRow
                label="Profit"
                value={fmtFull(selectedOrder.totalProfit)}
                valueClass={selectedOrder.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              <DetailRow
                label="Margin"
                value={`${selectedOrder.totalMarginPct.toFixed(1)}%`}
                valueClass={selectedOrder.totalMarginPct >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              <DetailRow
                label="Variable Margin"
                value={`${selectedOrder.variableMarginPct.toFixed(1)}%`}
                valueClass={selectedOrder.variableMarginPct >= 0 ? 'text-green-400' : 'text-red-400'}
              />
              <DetailRow label="Status" value={selectedOrder.status} />
              {selectedOrder.shippedDate && (
                <DetailRow label="Shipped" value={selectedOrder.shippedDate} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Detail Row ──────────────────────────────────────────────────────────────

function DetailRow({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`font-medium text-xs ${valueClass || ''}`}>{value}</span>
    </div>
  )
}

// ─── Trigger Button ──────────────────────────────────────────────────────────

export function RevenueConcentrationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] p-4 shadow-lg transition-all duration-200 hover:shadow-xl hover:border-white/[0.12] hover:bg-white/[0.04] cursor-pointer group flex items-center justify-between"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg p-2.5 bg-primary/10 text-primary">
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
        </div>
        <div className="text-left">
          <p className="text-sm font-semibold">Revenue Concentration</p>
          <p className="text-xs text-muted-foreground">Interactive treemap — click to explore customer & order breakdown</p>
        </div>
      </div>
      <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </button>
  )
}
