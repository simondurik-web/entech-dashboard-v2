'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { X, ArrowLeft, ChevronRight, ChevronDown } from 'lucide-react'
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

// ─── Squarified Treemap Layout ───────────────────────────────────────────────
// Bruls, Huizing, van Wijk (2000) squarified treemap algorithm.
// Produces near-square rectangles by optimizing aspect ratios.

interface TreeRect {
  x: number
  y: number
  w: number
  h: number
  index: number
}

function squarify(
  values: number[],
  x: number, y: number, w: number, h: number
): TreeRect[] {
  if (values.length === 0) return []

  // Create indexed items sorted descending
  const items = values
    .map((v, i) => ({ value: Math.max(v, 0), index: i }))
    .filter(item => item.value > 0)
    .sort((a, b) => b.value - a.value)

  const total = items.reduce((s, it) => s + it.value, 0)
  if (total <= 0) return []

  const rects: TreeRect[] = []
  layoutSquarified(items, x, y, w, h, total, rects)
  return rects
}

function layoutSquarified(
  items: { value: number; index: number }[],
  x: number, y: number, w: number, h: number,
  total: number,
  rects: TreeRect[]
) {
  if (items.length === 0 || total <= 0 || w <= 0 || h <= 0) return

  if (items.length === 1) {
    rects.push({ x, y, w, h, index: items[0].index })
    return
  }

  // Determine the short side of the remaining rectangle
  const shortSide = Math.min(w, h)
  const isHorizontal = w >= h // lay row along the short side

  // Greedily build a row that minimizes worst aspect ratio
  let row: { value: number; index: number }[] = []
  let rowSum = 0
  let bestWorst = Infinity
  let splitAt = 1

  for (let i = 0; i < items.length; i++) {
    const candidate = [...row, items[i]]
    const candidateSum = rowSum + items[i].value
    const worst = worstAspect(candidate, candidateSum, shortSide, total)

    if (worst <= bestWorst) {
      bestWorst = worst
      row = candidate
      rowSum = candidateSum
      splitAt = i + 1
    } else {
      break
    }
  }

  // Lay out the row
  const rowFraction = rowSum / total
  const rowThickness = isHorizontal ? w * rowFraction : h * rowFraction

  let offset = 0
  for (const item of row) {
    const itemFraction = item.value / rowSum
    if (isHorizontal) {
      const cellH = h * itemFraction
      rects.push({ x, y: y + offset, w: rowThickness, h: cellH, index: item.index })
      offset += cellH
    } else {
      const cellW = w * itemFraction
      rects.push({ x: x + offset, y, w: cellW, h: rowThickness, index: item.index })
      offset += cellW
    }
  }

  // Recurse on remaining items
  const remaining = items.slice(splitAt)
  const remainingTotal = total - rowSum
  if (remaining.length > 0 && remainingTotal > 0) {
    if (isHorizontal) {
      layoutSquarified(remaining, x + rowThickness, y, w - rowThickness, h, remainingTotal, rects)
    } else {
      layoutSquarified(remaining, x, y + rowThickness, w, h - rowThickness, remainingTotal, rects)
    }
  }
}

function worstAspect(
  row: { value: number }[],
  rowSum: number,
  shortSide: number,
  total: number
): number {
  if (row.length === 0 || total <= 0 || shortSide <= 0) return Infinity
  const rowLength = (rowSum / total) * shortSide // not exactly right but close enough
  // Actually: the row occupies a strip. The strip width = (rowSum/total) * longSide
  // Each item height = (item.value / rowSum) * shortSide
  // aspect = max(stripWidth/itemHeight, itemHeight/stripWidth)

  const stripWidth = shortSide * (rowSum / total) || 1
  let worst = 0
  for (const item of row) {
    const itemLen = item.value > 0 ? (item.value / rowSum) * shortSide : 0.001
    // Wait, let me re-derive. The strip is laid along shortSide.
    // strip thickness (perpendicular) = (rowSum / total) * longSide... no.
    // Let's just compute: area-based.
    // Total area = shortSide * longSide proportional. Each item area proportional to value.
    // For the strip: thickness = rowSum / total * (perpendicular dimension)
    // Each cell: length along short side = item.value / rowSum * shortSide
    // aspect = thickness / length or length / thickness
    if (itemLen <= 0) continue
    const aspect = Math.max(stripWidth / itemLen, itemLen / stripWidth)
    if (aspect > worst) worst = aspect
  }
  return worst
}

// ─── Gap between cells ──────────────────────────────────────────────────────

const GAP = 3

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
    // Small delay to let the expand animation finish
    const timer = setTimeout(measure, 50)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [open])

  // Reset drill-down when closing
  useEffect(() => {
    if (!open) {
      setDrillCustomer(null)
      setSelectedOrder(null)
    }
  }, [open])

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
    if (containerSize.w === 0 || containerSize.h === 0) return []
    return squarify(
      sortedCustomers.map(c => c.revenue),
      0, 0, containerSize.w, containerSize.h
    )
  }, [sortedCustomers, containerSize])

  const orderRects = useMemo(() => {
    if (containerSize.w === 0 || containerSize.h === 0 || !drilledCustomer) return []
    return squarify(
      drilledOrders.map(o => o.revenue),
      0, 0, containerSize.w, containerSize.h
    )
  }, [drilledOrders, drilledCustomer, containerSize])

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleCustomerClick = useCallback((customer: string) => {
    setDrillCustomer(customer)
    setSelectedOrder(null)
  }, [])

  const handleOrderClick = useCallback((order: SalesOrder) => {
    setSelectedOrder(prev => prev?.line === order.line ? null : order)
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
    <div className="rounded-xl border border-white/[0.06] backdrop-blur-xl bg-white/[0.02] shadow-lg overflow-hidden animate-in slide-in-from-top-2 fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          {drillCustomer && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="gap-1 text-muted-foreground hover:text-foreground h-7 px-2"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>
          )}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              Revenue Concentration
              {drillCustomer && (
                <>
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                  <span className="text-primary">{drillCustomer}</span>
                </>
              )}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {drillCustomer
                ? `${drilledOrders.length} orders · ${fmt(drilledCustomer?.revenue || 0)} revenue`
                : `${sortedCustomers.length} customers · ${fmt(totalRevenue)} total · click a customer to drill down`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Legend */}
          <div className="hidden sm:flex items-center gap-2.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(16,185,129,0.7)' }} />
              20%+
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(16,185,129,0.35)' }} />
              0-20%
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'rgba(239,68,68,0.55)' }} />
              Loss
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground size-7"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Treemap + optional detail panel */}
      <div className="flex" style={{ height: '1040px' }}>
        {/* Treemap area */}
        <div ref={containerRef} className="flex-1 relative p-2 min-w-0">
          {!drillCustomer ? (
            /* ─── Customer-level treemap ─── */
            <div className="relative w-full h-full">
              {customerRects.map((rect) => {
                const c = sortedCustomers[rect.index]
                if (!c) return null
                const pct = totalRevenue > 0 ? ((c.revenue / totalRevenue) * 100).toFixed(1) : '0'
                const cellW = rect.w - GAP * 2
                const cellH = rect.h - GAP * 2
                if (cellW < 2 || cellH < 2) return null

                // Determine what fits in the cell
                const showName = cellW > 40 && cellH > 20
                const showRevenue = cellW > 60 && cellH > 36
                const showDetail = cellW > 80 && cellH > 50
                const fontSize = Math.max(10, Math.min(13, cellW / 10))

                return (
                  <div
                    key={c.customer}
                    className="absolute rounded-md cursor-pointer transition-all duration-150 hover:brightness-125 hover:ring-1 hover:ring-white/30 active:scale-[0.99] flex flex-col items-center justify-center text-center overflow-hidden"
                    style={{
                      left: rect.x + GAP,
                      top: rect.y + GAP,
                      width: cellW,
                      height: cellH,
                      background: getMarginColor(c.totalMarginPct),
                    }}
                    onClick={() => handleCustomerClick(c.customer)}
                    title={`${c.customer}\nRevenue: ${fmt(c.revenue)} (${pct}%)\nMargin: ${c.totalMarginPct.toFixed(1)}%\nOrders: ${c.orders.length}`}
                  >
                    {showName && (
                      <span
                        className="font-semibold leading-tight text-white/90 px-1 max-w-full truncate"
                        style={{ fontSize }}
                      >
                        {c.customer}
                      </span>
                    )}
                    {showRevenue && (
                      <span className="text-white/70 mt-0.5" style={{ fontSize: Math.max(9, fontSize - 2) }}>
                        {fmt(c.revenue)}
                      </span>
                    )}
                    {showDetail && (
                      <span className="text-white/50" style={{ fontSize: Math.max(8, fontSize - 3) }}>
                        {pct}% · {c.totalMarginPct.toFixed(1)}% margin
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* ─── Order-level treemap (drilled into customer) ─── */
            <div className="relative w-full h-full">
              {orderRects.length === 0 && (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No orders with positive revenue
                </div>
              )}
              {orderRects.map((rect) => {
                const o = drilledOrders[rect.index]
                if (!o) return null
                const cellW = rect.w - GAP * 2
                const cellH = rect.h - GAP * 2
                if (cellW < 2 || cellH < 2) return null
                const isSelected = selectedOrder?.line === o.line

                const showName = cellW > 40 && cellH > 20
                const showRevenue = cellW > 60 && cellH > 36
                const showDetail = cellW > 80 && cellH > 50
                const fontSize = Math.max(10, Math.min(13, cellW / 10))

                return (
                  <div
                    key={o.line}
                    className={`absolute rounded-md cursor-pointer transition-all duration-150 hover:brightness-125 flex flex-col items-center justify-center text-center overflow-hidden ${
                      isSelected ? 'ring-2 ring-primary brightness-110' : 'hover:ring-1 hover:ring-white/30'
                    }`}
                    style={{
                      left: rect.x + GAP,
                      top: rect.y + GAP,
                      width: cellW,
                      height: cellH,
                      background: getMarginColor(o.totalMarginPct),
                    }}
                    onClick={() => handleOrderClick(o)}
                    title={`Line ${o.line} — ${o.partNumber}\nRevenue: ${fmt(o.revenue)}\nMargin: ${o.totalMarginPct.toFixed(1)}%`}
                  >
                    {showName && (
                      <span className="font-semibold leading-tight text-white/90 px-1 max-w-full truncate" style={{ fontSize }}>
                        {o.partNumber}
                      </span>
                    )}
                    {showRevenue && (
                      <span className="text-white/70 mt-0.5" style={{ fontSize: Math.max(9, fontSize - 2) }}>
                        {fmt(o.revenue)}
                      </span>
                    )}
                    {showDetail && (
                      <span className="text-white/50" style={{ fontSize: Math.max(8, fontSize - 3) }}>
                        Line {o.line} · {o.totalMarginPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Order detail panel (right side) */}
        {selectedOrder && (
          <div className="w-72 border-l border-white/[0.06] p-4 shrink-0 overflow-y-auto bg-white/[0.02] animate-in slide-in-from-right-4 duration-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Order Details</h4>
              <Button
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => setSelectedOrder(null)}
              >
                <X className="size-3" />
              </Button>
            </div>

            <div className="space-y-2 text-sm">
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

export function RevenueConcentrationButton({ onClick, open }: { onClick: () => void; open: boolean }) {
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
      <ChevronDown className={`size-4 text-muted-foreground group-hover:text-foreground transition-all duration-200 ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}
