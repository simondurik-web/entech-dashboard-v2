// Whether a live inventory pull is trustworthy enough to email to accounting.
//
// Split out of the cron route so the fail-closed contract is testable. This is the one
// decision standing between a broken ERPNext read and a spreadsheet an accountant will
// treat as fact, and it was previously only exercisable by running the whole endpoint.
//
// Three shortfalls are checked separately, because they fail independently and each one
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
// com.entech.inventory-snapshot, an independent record of the same facility.

/** Per-metric, because a single floor is forced down to the loosest metric's tolerance and
 *  then lets material omissions through everywhere else.
 *
 *  Measured 2026-07-31, live against snapshot: 1,150 vs 1,152 bin rows (0.2% apart), 493 vs
 *  493 stocked parts (exact), 1,142 vs 1,219 listed parts (6% apart — the snapshot retains
 *  parts the live catalogue filter drops). The first two admit a tight floor; only the third
 *  has real structural skew to absorb, so only the third is loose. */
export const COMPLETENESS_FLOORS = {
  binRows: 0.95,
  stockedParts: 0.95,
  totalParts: 0.85,
} as const

export interface SnapshotFigures {
  binRows: number | null
  stockedParts: number | null
  totalParts: number | null
  /** A query FAILED, as opposed to there being no snapshot to read. See below. */
  unavailable: boolean
}

export interface CompletenessInput {
  /** Bin rows returned by ERPNext. */
  rowCount: number
  /** Distinct part numbers with a non-zero bin, from bin rows ONLY — never the zero-fill. */
  stockedCount: number
  /** Every part on the By Product tab, including zero-filled ones. */
  totalParts: number
  /** The catalog zero-fill could not be loaded at all. */
  binlessItemsUnavailable: boolean
  snapshot: SnapshotFigures
}

function shortfall(
  label: string,
  actual: number,
  expected: number | null,
  floorShare: number
): string | null {
  if (expected === null || expected <= 0) return null
  const floor = Math.floor(expected * floorShare)
  if (actual >= floor) return null
  return `${label}: ${actual} against ${expected} in the latest snapshot (floor ${floor})`
}

/** Every reason this pull must not be shipped. Empty means it is safe to send. */
export function incompletenessReasons(input: CompletenessInput): string[] {
  const reasons: string[] = []
  if (input.rowCount === 0) reasons.push('ERPNext returned no inventory rows')
  if (input.binlessItemsUnavailable) reasons.push('zero-quantity catalog items are unavailable')

  // A failed snapshot query is not the same as no snapshot. If the comparison simply has
  // nothing to compare against, shipping is still reasonable — the caller keeps its own
  // baseline, and one broken cron must not silently take out another. But if the query
  // ERRORED, the guard did not run and we cannot claim the pull was checked. Saying nothing
  // in that case is how a fail-closed contract quietly becomes fail-open.
  if (input.snapshot.unavailable) {
    reasons.push('could not read the comparison snapshot, so completeness is unverified')
  }

  const shortfalls = [
    shortfall('bin rows', input.rowCount, input.snapshot.binRows, COMPLETENESS_FLOORS.binRows),
    shortfall(
      'parts with stock',
      input.stockedCount,
      input.snapshot.stockedParts,
      COMPLETENESS_FLOORS.stockedParts
    ),
    shortfall(
      'parts listed',
      input.totalParts,
      input.snapshot.totalParts,
      COMPLETENESS_FLOORS.totalParts
    ),
  ].filter((reason): reason is string => reason !== null)

  if (shortfalls.length > 0) {
    reasons.push(`looks like a partial inventory — ${shortfalls.join('; ')}`)
  }
  return reasons
}
