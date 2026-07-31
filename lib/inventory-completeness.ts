// Whether a live inventory pull is trustworthy enough to email to accounting.
//
// Split out of the cron route so the fail-closed contract is testable. This is the one
// decision that stands between a broken ERPNext read and a spreadsheet an accountant will
// treat as fact, and it was previously only exercised by running the whole endpoint.

/** Below this share of the last snapshot's STOCKED part count, treat the live pull as partial.
 *
 *  Measured 2026-07-31: 493 stocked parts live, 493 in the snapshot — the two track exactly,
 *  because both count the same thing. The margin is for ordinary stock movement between the
 *  snapshot and the run, not for a structural gap. */
export const COMPLETENESS_FLOOR = 0.75

export interface CompletenessInput {
  /** Distinct part numbers with a non-zero bin, counted from bin rows ONLY. */
  stockedCount: number
  /** Total bin rows returned by ERPNext. */
  rowCount: number
  /** The catalog zero-fill could not be loaded, so zero-qty parts may be missing. */
  binlessItemsUnavailable: boolean
  /** Stocked parts in the latest nightly snapshot, or null when there is none to compare. */
  snapshotStocked: number | null
}

/** Every reason this pull must not be shipped. Empty means it is safe to send.
 *
 *  `stockedCount` must be derived from bins alone. Including the zero-fill defeats the
 *  whole check: under the failure this guards against — bins partial, Item list intact —
 *  the padded count barely moves, so a materially wrong workbook reads as healthy. */
export function incompletenessReasons(input: CompletenessInput): string[] {
  const reasons: string[] = []
  if (input.rowCount === 0) reasons.push('ERPNext returned no inventory rows')
  if (input.binlessItemsUnavailable) reasons.push('zero-quantity catalog items are unavailable')
  if (
    input.snapshotStocked !== null &&
    input.snapshotStocked > 0 &&
    input.stockedCount < Math.floor(input.snapshotStocked * COMPLETENESS_FLOOR)
  ) {
    reasons.push(
      `only ${input.stockedCount} parts have stock, against ${input.snapshotStocked} in the latest snapshot — looks like a partial inventory`
    )
  }
  return reasons
}
