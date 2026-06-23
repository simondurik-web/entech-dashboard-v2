// Shared pallet-record enrichment for the Pallet Load Calculator.
//
// Both the Shipping Overview page and the Ready to Ship (staged) page embed the
// same <PalletLoadCalculator>, and both must enrich their orders with the REAL
// built-pallet count (number of pallet_records), not the order's estimated
// numPackages (order_qty / parts_per_package). These two pages previously each
// had their own copy of this logic and drifted apart, causing the calculator to
// show different counts for the same order. Keep the logic here, single-sourced,
// so the two pages can never diverge again. Each page only differs in how it
// normalizes its data source into NormalizedPalletRecord[].
import type { Order } from './google-sheets-shared'

export interface NormalizedPalletRecord {
  /** Line number (fall back to order number) the pallet belongs to. */
  line: string
  /** Dimensions string, e.g. "48x48x27". */
  dimensions: string
  /** Per-pallet weight in lbs. */
  weight: number
}

export interface PalletLineEnrichment {
  avgWeight: number
  width: number
  length: number
  /** Number of real pallet records for this line. */
  count: number
  pallets: { dimensions: string; weight: number }[]
}

/** Group flat pallet records by line into per-line enrichment data. */
export function buildPalletEnrichmentByLine(
  records: NormalizedPalletRecord[],
): Map<string, PalletLineEnrichment> {
  const grouped = new Map<string, NormalizedPalletRecord[]>()
  for (const r of records) {
    const key = (r.line || '').trim()
    if (!key) continue
    const arr = grouped.get(key) ?? []
    arr.push(r)
    grouped.set(key, arr)
  }

  const byLine = new Map<string, PalletLineEnrichment>()
  for (const [line, recs] of grouped) {
    const totalW = recs.reduce((s, p) => s + (p.weight || 0), 0)
    const avgWeight = recs.length > 0 ? Math.round(totalW / recs.length) : 0
    let width = 0
    let length = 0
    const firstDims = recs.find((p) => p.dimensions)?.dimensions || ''
    if (firstDims) {
      const parts = firstDims.split(/x/i).map((s) => parseFloat(s.trim()))
      if (parts.length >= 2) {
        width = parts[0] || 0
        length = parts[1] || 0
      }
    }
    byLine.set(line, {
      avgWeight,
      width,
      length,
      count: recs.length,
      pallets: recs.map((p) => ({ dimensions: p.dimensions || '', weight: p.weight || 0 })),
    })
  }
  return byLine
}

/**
 * Apply pallet enrichment to one order, matching by line then IF number.
 * When real pallet records exist, sets the dimensions, per-pallet weight, the
 * real pallet count (numPackages) and attaches the pallet records so the
 * calculator groups them into configs. Returns the order untouched when no
 * pallet records are found, so callers keep their own estimate fallback.
 */
export function applyPalletEnrichment<T extends { line?: string | number; ifNumber?: string }>(
  order: T,
  byLine: Map<string, PalletLineEnrichment>,
): T {
  const pd =
    byLine.get(String(order.line ?? '').trim()) || byLine.get(String(order.ifNumber ?? '').trim())
  if (!pd) return order
  return {
    ...order,
    palletWidth: pd.width,
    palletLength: pd.length,
    palletWeightEach: pd.avgWeight,
    numPackages: pd.count,
    pallets: pd.pallets,
  } as T
}

/** Order shape after enrichment (adds the dynamically-attached pallets array). */
export type EnrichedOrder = Order & { pallets?: { dimensions: string; weight: number }[] }
