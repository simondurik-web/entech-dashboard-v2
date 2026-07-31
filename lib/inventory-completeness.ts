// Whether a live inventory pull is trustworthy enough to email to accounting.
//
// Split out of the cron route so the fail-closed contract is testable. This is the one
// decision standing between a broken ERPNext read and a spreadsheet an accountant will
// treat as fact, and it was previously only exercisable by running the whole endpoint.
//
// Three separate shortfalls are checked, because they fail independently and each one
// hides from the others:
//
//   bin rows    — a warehouse disappearing from ERPNext's response takes its rows with it,
//                 even when every part in it also lives somewhere else (so the part counts
//                 below would not move at all).
//   stocked     — a partial bin read understates what is on hand. Counted from bins only:
//                 the catalog zero-fill pads the TOTAL back to full, which is exactly how
//                 the first version of this guard managed to be blind to its own purpose.
//   total parts — the catalog read is a separate call with its own failure mode. A partial
//                 catalog silently drops zero-quantity parts, which is the very thing the
//                 zero-fill exists to guarantee for accounting's lookups.
//
// All three are measured against the nightly snapshot written by
// com.entech.inventory-snapshot, which is an independent record of the same facility.

/** Below this share of the corresponding snapshot figure, treat the live pull as partial.
 *
 *  Measured 2026-07-31, live against snapshot: 1,150 vs 1,152 bin rows, 493 vs 493 stocked
 *  parts, 1,142 vs 1,219 total parts. The first two track almost exactly; total parts sits
 *  ~6% low because the snapshot retains parts the live catalogue filter drops. The margin
 *  is for that skew plus ordinary stock movement, not for a structural gap — and a false
 *  alarm costs the month's report, so it is deliberately not tighter. */
export const COMPLETENESS_FLOOR = 0.75

export interface CompletenessInput {
  /** Bin rows returned by ERPNext. */
  rowCount: number
  /** Distinct part numbers with a non-zero bin, from bin rows ONLY — never the zero-fill. */
  stockedCount: number
  /** Every part on the By Product tab, including zero-filled ones. */
  totalParts: number
  /** The catalog zero-fill could not be loaded at all. */
  binlessItemsUnavailable: boolean
  /** Latest snapshot's figures, or null where there is nothing to compare against. */
  snapshot: {
    binRows: number | null
    stockedParts: number | null
    totalParts: number | null
  }
}

function shortfall(label: string, actual: number, expected: number | null): string | null {
  if (expected === null || expected <= 0) return null
  const floor = Math.floor(expected * COMPLETENESS_FLOOR)
  if (actual >= floor) return null
  return `${label}: ${actual} against ${expected} in the latest snapshot (floor ${floor})`
}

/** Every reason this pull must not be shipped. Empty means it is safe to send. */
export function incompletenessReasons(input: CompletenessInput): string[] {
  const reasons: string[] = []
  if (input.rowCount === 0) reasons.push('ERPNext returned no inventory rows')
  if (input.binlessItemsUnavailable) reasons.push('zero-quantity catalog items are unavailable')

  const shortfalls = [
    shortfall('bin rows', input.rowCount, input.snapshot.binRows),
    shortfall('parts with stock', input.stockedCount, input.snapshot.stockedParts),
    shortfall('parts listed', input.totalParts, input.snapshot.totalParts),
  ].filter((reason): reason is string => reason !== null)

  if (shortfalls.length > 0) {
    reasons.push(`looks like a partial inventory — ${shortfalls.join('; ')}`)
  }
  return reasons
}
