/**
 * At-risk customer detection — derive risk tier per customer from their
 * personal order cadence, not a flat days-threshold. A weekly-orderer is
 * in crisis at 60 days; a quarterly-orderer is normal at 60 days.
 *
 * Inputs are the per-customer order list already loaded by the Sales by
 * Customer page (SalesOrder[]). Everything here is pure — no DB, no fetch.
 *
 * Risk tiers (per-customer baseline, where median = medianDaysBetweenOrders):
 *   active   — daysSinceLastOrder <= 1.5 * median  (or has open work)
 *   watch    — 1.5 * median < daysSince <= 2.5 * median
 *   at_risk  — 2.5 * median < daysSince <= 4 * median
 *   dormant  — 4 * median < daysSince AND daysSince < 365
 *   churned  — daysSince >= 365
 *   new      — fewer than 2 historical shipped orders (no baseline)
 *
 * Customer is forced to `active` regardless of cadence if they have any
 * order with empty shippedDate OR a status not in the closed set —
 * meaning they have current/future business in flight.
 */

export type RiskTier = "active" | "watch" | "at_risk" | "dormant" | "churned" | "new"

export interface OrderForRisk {
  shippedDate?: string
  status?: string
  revenue?: number
  qty?: number
  partNumber?: string
}

export interface CustomerRiskMetrics {
  lastOrderDate: Date | null
  daysSinceLastOrder: number | null
  hasOpenWork: boolean
  shippedOrderCount: number
  medianDaysBetweenOrders: number | null
  riskTier: RiskTier
  revenue12mo: number
}

export interface PartRiskMetrics {
  partNumber: string
  lastOrderDate: Date | null
  daysSinceLastOrder: number | null
  monthlyAvgQty: number       // qty per month, rolling 12-month
  monthlyAvgRevenue: number   // revenue per month, rolling 12-month
  orderCount12mo: number
}

// "Closed" statuses (shipped variants). Anything else = open work in flight.
const CLOSED_STATUSES = new Set([
  "shipped", "invoiced", "to bill", "closed", "cancelled", "completed",
])

const MS_PER_DAY = 86_400_000

function parseDate(s?: string): Date | null {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function isOpenOrder(o: OrderForRisk): boolean {
  // No shipped date OR status is non-closed
  if (!o.shippedDate || !o.shippedDate.trim()) return true
  const status = (o.status || "").trim().toLowerCase()
  if (status && !CLOSED_STATUSES.has(status)) return true
  return false
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_DAY)
}

/**
 * Compute risk metrics for a single customer from their order list.
 * `now` is overridable for deterministic tests (default: actual now).
 */
export function computeCustomerRiskMetrics(
  orders: OrderForRisk[],
  now: Date = new Date(),
): CustomerRiskMetrics {
  // Collect shipped order dates (used for last-order + cadence).
  const shippedDates: Date[] = []
  let hasOpen = false
  let revenue12mo = 0
  const cutoff12mo = new Date(now.getTime() - 365 * MS_PER_DAY)

  for (const o of orders) {
    if (isOpenOrder(o)) {
      hasOpen = true
      continue  // open work doesn't count toward last-shipped baseline
    }
    const d = parseDate(o.shippedDate)
    if (!d) continue
    shippedDates.push(d)
    if (d >= cutoff12mo) revenue12mo += o.revenue ?? 0
  }

  if (shippedDates.length === 0) {
    return {
      lastOrderDate: null,
      daysSinceLastOrder: null,
      hasOpenWork: hasOpen,
      shippedOrderCount: 0,
      medianDaysBetweenOrders: null,
      riskTier: hasOpen ? "active" : "new",
      revenue12mo: 0,
    }
  }

  shippedDates.sort((a, b) => a.getTime() - b.getTime())
  const lastOrderDate = shippedDates[shippedDates.length - 1]
  const daysSinceLastOrder = daysBetween(now, lastOrderDate)

  // Gaps between consecutive shipped orders → median = customer's cadence
  const gaps: number[] = []
  for (let i = 1; i < shippedDates.length; i++) {
    gaps.push(daysBetween(shippedDates[i], shippedDates[i - 1]))
  }
  const medianGap = median(gaps)

  // Open work forces active regardless of gap
  if (hasOpen) {
    return {
      lastOrderDate,
      daysSinceLastOrder,
      hasOpenWork: true,
      shippedOrderCount: shippedDates.length,
      medianDaysBetweenOrders: medianGap,
      riskTier: "active",
      revenue12mo,
    }
  }

  // No baseline (only one historical shipped order) → "new"
  if (medianGap === null || shippedDates.length < 2) {
    return {
      lastOrderDate,
      daysSinceLastOrder,
      hasOpenWork: false,
      shippedOrderCount: shippedDates.length,
      medianDaysBetweenOrders: null,
      riskTier: daysSinceLastOrder >= 365 ? "churned" : "new",
      revenue12mo,
    }
  }

  // Bound the median so customers with super-tight cadence (median=1 day)
  // don't flag at 2 days. Floor of 14 days = "weekly is the tightest cadence
  // we care about for outreach prioritization."
  const baseline = Math.max(medianGap, 14)

  let tier: RiskTier
  if (daysSinceLastOrder >= 365) tier = "churned"
  else if (daysSinceLastOrder > 4 * baseline) tier = "dormant"
  else if (daysSinceLastOrder > 2.5 * baseline) tier = "at_risk"
  else if (daysSinceLastOrder > 1.5 * baseline) tier = "watch"
  else tier = "active"

  return {
    lastOrderDate,
    daysSinceLastOrder,
    hasOpenWork: false,
    shippedOrderCount: shippedDates.length,
    medianDaysBetweenOrders: medianGap,
    riskTier: tier,
    revenue12mo,
  }
}

/**
 * Per-part rolling-12-month aggregates for a single customer.
 * Returns one entry per unique partNumber.
 */
export function computeCustomerPartRiskMetrics(
  orders: OrderForRisk[],
  now: Date = new Date(),
): PartRiskMetrics[] {
  const cutoff12mo = new Date(now.getTime() - 365 * MS_PER_DAY)
  const byPart = new Map<string, OrderForRisk[]>()
  for (const o of orders) {
    const key = o.partNumber || "Unknown"
    const arr = byPart.get(key)
    if (arr) arr.push(o)
    else byPart.set(key, [o])
  }
  const out: PartRiskMetrics[] = []
  for (const [partNumber, orderList] of byPart) {
    const shippedDates: Date[] = []
    let qty12mo = 0
    let revenue12mo = 0
    let count12mo = 0
    for (const o of orderList) {
      const d = parseDate(o.shippedDate)
      if (!d) continue
      shippedDates.push(d)
      if (d >= cutoff12mo) {
        qty12mo += o.qty ?? 0
        revenue12mo += o.revenue ?? 0
        count12mo += 1
      }
    }
    const lastOrderDate = shippedDates.length
      ? shippedDates.reduce((a, b) => (a.getTime() > b.getTime() ? a : b))
      : null
    const daysSinceLastOrder = lastOrderDate ? daysBetween(now, lastOrderDate) : null
    out.push({
      partNumber,
      lastOrderDate,
      daysSinceLastOrder,
      // Rolling 12mo avg / month — divide by 12 not by months-present, so
      // a sporadic part shows true monthly tempo (averaged across the whole
      // window, including silent months).
      monthlyAvgQty: qty12mo / 12,
      monthlyAvgRevenue: revenue12mo / 12,
      orderCount12mo: count12mo,
    })
  }
  return out
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export const RISK_TIER_LABEL: Record<RiskTier, string> = {
  active: "Active",
  watch: "Watch",
  at_risk: "At Risk",
  dormant: "Dormant",
  churned: "Churned",
  new: "New",
}

export const RISK_TIER_LABEL_ES: Record<RiskTier, string> = {
  active: "Activo",
  watch: "Vigilar",
  at_risk: "En Riesgo",
  dormant: "Inactivo",
  churned: "Perdido",
  new: "Nuevo",
}

/**
 * Tailwind classes for the risk-tier chip. Tier shades come in light/dark
 * pairs (text-{color}-700 on light theme, text-{color}-400 on dark) since
 * the -400 shades wash out on white backgrounds and the -700 shades go dark
 * on the dark-mode card.
 */
export const RISK_TIER_CLASSES: Record<RiskTier, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40",
  watch: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/40",
  at_risk: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/40",
  dormant: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40",
  churned: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400 border-zinc-500/40",
  new: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40",
}

/** Tier color for inline numeric "days since" text. Same dual-theme pattern. */
export const DAYS_SINCE_COLOR_CLASSES = {
  fresh: "text-emerald-700 dark:text-emerald-400",
  warm: "text-yellow-700 dark:text-yellow-400",
  hot: "text-orange-700 dark:text-orange-400",
  cold: "text-red-700 dark:text-red-400",
} as const

export function daysSinceColorClass(days: number | null | undefined): string {
  if (days == null) return "text-muted-foreground"
  if (days > 180) return DAYS_SINCE_COLOR_CLASSES.cold
  if (days > 90) return DAYS_SINCE_COLOR_CLASSES.hot
  if (days > 45) return DAYS_SINCE_COLOR_CLASSES.warm
  return DAYS_SINCE_COLOR_CLASSES.fresh
}

export const RISK_TIER_HEX: Record<RiskTier, string> = {
  active: "#10b981",
  watch: "#eab308",
  at_risk: "#f97316",
  dormant: "#ef4444",
  churned: "#71717a",
  new: "#3b82f6",
}

/** Order tiers from highest priority to lowest for sorting (at-risk first). */
export const RISK_TIER_PRIORITY: Record<RiskTier, number> = {
  at_risk: 0,
  dormant: 1,
  watch: 2,
  churned: 3,
  new: 4,
  active: 5,
}

export function formatShortDate(d: Date | null, locale: string = "en-US"): string {
  if (!d) return "—"
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })
}

/** Compact currency for chart tooltips/labels — shared by both at-risk charts. */
export function fmtRevenueShort(v: number, locale: string = "en-US"): string {
  if (!Number.isFinite(v)) return "—"
  if (v >= 1_000_000) return `$${(v / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
  if (v >= 1_000) return `$${(v / 1_000).toLocaleString(locale, { maximumFractionDigits: 0 })}k`
  return `$${v.toLocaleString(locale, { maximumFractionDigits: 0 })}`
}

/** Language-aware tier label. */
export function getRiskTierLabel(tier: RiskTier, language: "en" | "es" = "en"): string {
  return (language === "es" ? RISK_TIER_LABEL_ES : RISK_TIER_LABEL)[tier]
}
