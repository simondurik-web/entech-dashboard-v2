/**
 * Spec-limit lookup + status for Quality inspection measurements.
 *
 * Ported from the standalone EQDR app's lib/limits-lookup.ts. The source app
 * disabled time-windowing on 2026-05-21 ("the current spec IS the spec") — so
 * we only need the current limits from `qa_product_limits`; the
 * `qa_product_limit_history` table is still written for audit but is NOT
 * consulted for spec evaluation. That lets this port stay lean.
 *
 * A measurement is evaluated against the limit for its
 * (product_type, product_number, metric_key) and colored green/amber/red.
 */

export interface EffectiveLimit {
  min: number | null
  target: number | null
  max: number | null
}

export type SpecStatus =
  | 'no_limit'   // no limit configured AND no target — plain value
  | 'no_target'  // value present, inside band, but no target to compare
  | 'red'        // outside [min, max]
  | 'amber'      // inside [min, max] but more than 3% off target
  | 'green'      // inside [min, max] AND within 3% of target

const TARGET_BAND_PCT = 0.03

export type QaLimitRow = {
  product_type: string
  product_number: string
  metric_key: string
  min_value: number | null
  target_value: number | null
  max_value: number | null
}

/** Map keyed by `${product_type}::${product_number}::${metric_key}`. */
export type LimitsIndex = Map<string, EffectiveLimit>

export function keyFor(productType: string, productNumber: string, metricKey: string): string {
  return `${productType}::${productNumber}::${metricKey}`
}

export function buildLimitsIndex(limits: QaLimitRow[]): LimitsIndex {
  const idx: LimitsIndex = new Map()
  for (const r of limits) {
    idx.set(keyFor(r.product_type, r.product_number, r.metric_key), {
      min: r.min_value,
      target: r.target_value,
      max: r.max_value,
    })
  }
  return idx
}

export function findLimit(
  index: LimitsIndex,
  productType: string,
  productNumber: string | null | undefined,
  metricKey: string,
): EffectiveLimit | null {
  if (!productNumber) return null
  return index.get(keyFor(productType, productNumber, metricKey)) ?? null
}

export function computeSpecStatus(value: number | null, lim: EffectiveLimit | null): SpecStatus {
  if (value == null) return 'no_limit'
  const min = lim?.min ?? null
  const max = lim?.max ?? null
  const target = lim?.target ?? null

  if (min != null && value < min) return 'red'
  if (max != null && value > max) return 'red'

  if (target == null || target === 0) {
    if (min == null && max == null) return 'no_limit'
    return 'no_target'
  }
  const pct = Math.abs((value - target) / target)
  return pct <= TARGET_BAND_PCT ? 'green' : 'amber'
}

/** Tailwind text-color class for a SpecStatus. Centralized so every screen matches. */
export function specStatusClass(status: SpecStatus): string {
  switch (status) {
    case 'red':   return 'text-red-500 dark:text-red-400'
    case 'amber': return 'text-amber-500 dark:text-amber-400'
    case 'green': return 'text-emerald-500 dark:text-emerald-400'
    case 'no_target':
    case 'no_limit':
    default:      return 'text-foreground'
  }
}
