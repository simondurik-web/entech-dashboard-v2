import { todayET } from './et-date'
import type {
  DailyOrdersRow,
  DailyRollupRow,
  ShipmentSummary,
  ShipmentTotals,
  VolumeBucket,
  VolumeBucketSize,
} from './types'

function emptyTotals(): ShipmentTotals {
  return { units: 0, lines: 0, orders: 0 }
}

function numeric(value: number | string | null): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// When DailyOrdersRow[] is supplied, order counts come exclusively from it (the
// per-part rollup's orders column double-counts multi-part POs) — so the daily
// rows must then contribute units/lines only.
function addTotals(target: ShipmentTotals, row: DailyRollupRow, includeOrders: boolean): void {
  target.units += numeric(row.units)
  target.lines += numeric(row.lines)
  if (includeOrders) target.orders += numeric(row.orders)
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

function mondayOfWeek(day: string): string {
  const date = parseDay(day)
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)
  return isoDate(date)
}

function bucketKey(day: string, bucket: VolumeBucketSize): string {
  if (bucket === 'day') return day
  if (bucket === 'week') return mondayOfWeek(day)
  if (bucket === 'month') return day.slice(0, 7)
  const year = day.slice(0, 4)
  if (bucket === 'year') return year
  const month = Number(day.slice(5, 7))
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
}

export function bucketize(
  daily: DailyRollupRow[],
  bucket: VolumeBucketSize,
  dailyOrders?: DailyOrdersRow[],
  range?: { from: string; to: string },
): VolumeBucket[] {
  const buckets = new Map<string, VolumeBucket>()
  const useOrderRows = dailyOrders !== undefined
  const getBucket = (day: string): VolumeBucket => {
    const key = bucketKey(day, bucket)
    let current = buckets.get(key)
    if (!current) {
      current = { bucket: key, ...emptyTotals(), bySource: {}, parts: {} }
      buckets.set(key, current)
    }
    return current
  }

  // Pre-seed every bucket in the requested range so zero-shipment days/weeks
  // still occupy their slot on the (categorical) time axis instead of the gaps
  // silently compressing the series.
  if (range && range.from <= range.to) {
    let day = range.from
    while (day <= range.to) {
      getBucket(day)
      const [year, month, date] = day.split('-').map(Number)
      day = new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10)
    }
  }

  for (const row of daily) {
    const current = getBucket(row.day)
    addTotals(current, row, !useOrderRows)

    const source = row.source_system || 'Unknown'
    const sourceTotals = current.bySource[source] ?? emptyTotals()
    addTotals(sourceTotals, row, !useOrderRows)
    current.bySource[source] = sourceTotals

    const part = row.part_number || 'Unknown'
    current.parts[part] = (current.parts[part] ?? 0) + numeric(row.units)
  }

  // Order counts: per-day distinct POs summed into the bucket (a PO spanning two
  // ET days counts once per day it shipped on — day-level distinct is the grain).
  for (const row of dailyOrders ?? []) {
    const current = getBucket(row.day)
    const orders = numeric(row.orders)
    current.orders += orders
    const source = row.source_system || 'Unknown'
    const sourceTotals = current.bySource[source] ?? emptyTotals()
    sourceTotals.orders += orders
    current.bySource[source] = sourceTotals
  }

  return [...buckets.values()].sort((left, right) => left.bucket.localeCompare(right.bucket))
}

export function topPartsWithOther(
  rows: VolumeBucket[],
  n = 8
): { buckets: VolumeBucket[]; parts: string[] } {
  const totals = new Map<string, number>()
  for (const row of rows) {
    for (const [part, units] of Object.entries(row.parts)) {
      totals.set(part, (totals.get(part) ?? 0) + numeric(units))
    }
  }

  const limit = Math.max(0, Math.floor(n))
  const ranked = [...totals.entries()]
    .sort(([leftPart, leftUnits], [rightPart, rightUnits]) =>
      rightUnits - leftUnits || leftPart.localeCompare(rightPart)
    )
    .map(([part]) => part)
  const topParts = ranked.slice(0, limit)
  const topSet = new Set(topParts)
  const hasOther = ranked.some((part) => !topSet.has(part))
  const parts = hasOther && !topSet.has('Other') ? [...topParts, 'Other'] : topParts

  const buckets = rows.map((row) => {
    const partStacks: Record<string, number> = {}
    for (const part of topParts) partStacks[part] = numeric(row.parts[part] ?? 0)

    if (hasOther) {
      const otherUnits = Object.entries(row.parts).reduce(
        (sum, [part, units]) => sum + (topSet.has(part) ? 0 : numeric(units)),
        0
      )
      partStacks.Other = (partStacks.Other ?? 0) + otherUnits
    }

    return { ...row, parts: partStacks }
  })

  return { buckets, parts }
}

export function summarize(
  daily: DailyRollupRow[],
  dailyOrders?: DailyOrdersRow[],
  today = todayET(),
): ShipmentSummary {
  const weekStart = mondayOfWeek(today)
  const useOrderRows = dailyOrders !== undefined
  const summary: ShipmentSummary = {
    today: emptyTotals(),
    thisWeek: emptyTotals(),
    bySource: {},
    ltl: { today: 0, thisWeek: 0 },
    latestDay: null,
  }
  const sourceSummaryFor = (source: string) => {
    const existing = summary.bySource[source] ?? { today: emptyTotals(), thisWeek: emptyTotals() }
    summary.bySource[source] = existing
    return existing
  }

  for (const row of daily) {
    if (summary.latestDay === null || row.day > summary.latestDay) summary.latestDay = row.day

    const isToday = row.day === today
    const isThisWeek = row.day >= weekStart && row.day <= today
    if (!isToday && !isThisWeek) continue

    const sourceSummary = sourceSummaryFor(row.source_system || 'Unknown')

    if (isToday) {
      addTotals(summary.today, row, !useOrderRows)
      addTotals(sourceSummary.today, row, !useOrderRows)
      if (row.service === 'LTL (set-aside)') summary.ltl.today += numeric(row.lines)
    }
    if (isThisWeek) {
      addTotals(summary.thisWeek, row, !useOrderRows)
      addTotals(sourceSummary.thisWeek, row, !useOrderRows)
      if (row.service === 'LTL (set-aside)') summary.ltl.thisWeek += numeric(row.lines)
    }
  }

  for (const row of dailyOrders ?? []) {
    const isToday = row.day === today
    const isThisWeek = row.day >= weekStart && row.day <= today
    if (!isToday && !isThisWeek) continue
    const orders = numeric(row.orders)
    const sourceSummary = sourceSummaryFor(row.source_system || 'Unknown')
    if (isToday) {
      summary.today.orders += orders
      sourceSummary.today.orders += orders
    }
    if (isThisWeek) {
      summary.thisWeek.orders += orders
      sourceSummary.thisWeek.orders += orders
    }
  }

  return summary
}
