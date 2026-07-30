// By Product totals for the full-inventory export.
//
// Extracted from the inventory-ops page so the one piece of arithmetic accounting
// actually depends on is testable: the same item sitting in six bins must collapse
// to one facility-wide total, and every live part must get a line even at zero.
//
// Zero-fill (Simon 2026-07-30): accounting VLOOKUPs this tab by part number onto
// their own sheets. A part that disappears from the file the moment it hits zero
// returns #N/A, which reads as "no such part" rather than "we're out of it". The
// server sends every part with no bin row as a `binlessItem` carrying its own
// quantity — 0 for the live catalog case, and for a dated export the product
// snapshot's number when the bin snapshot has no row for it. They land here and
// nowhere else: with no bin, the By Bin tab would only gain blank-bin noise.

export interface ProductTotalInput {
  itemCode?: unknown
  itemName?: unknown
  uom?: unknown
  qty?: unknown
}

/** A part with no bin row. Usually that means zero on hand (the live catalog case), but
 *  a dated export can also carry a part the product snapshot has stock for while the bin
 *  snapshot has no row at all — so the quantity travels with it instead of being assumed. */
export interface BinlessItemInput {
  itemCode?: unknown
  itemName?: unknown
  uom?: unknown
  qty?: unknown
}

export interface ProductTotal {
  itemCode: string
  itemName: string
  uom: string
  qty: number
}

/** A blank item code is not an identity — key those by name so unrelated uncoded
 *  rows don't collapse into one bogus line. */
function totalsKey(itemCode: string, itemName: string): string {
  return itemCode || `name:${itemName}`
}

/** One line per item code, totalled across bins, then zero-filled from the catalog.
 *  Sorted by name then code, matching the sheet the accounting team already reads. */
export function buildProductTotals(
  rows: readonly ProductTotalInput[],
  binlessItems: readonly BinlessItemInput[] = []
): ProductTotal[] {
  // The report payload is cast, not validated. Coerce every field: summing is
  // destructive in a way the old pass-through display was not — a qty that arrived
  // as a string would concatenate instead of add.
  const totals = new Map<string, ProductTotal>()
  for (const row of rows) {
    const itemCode = String(row.itemCode ?? '')
    const itemName = String(row.itemName ?? '') || itemCode
    const uom = String(row.uom ?? '')
    const qty = Number(row.qty)
    const key = totalsKey(itemCode, itemName)
    const running = totals.get(key)
    if (running) {
      running.qty += Number.isFinite(qty) ? qty : 0
      if (!running.uom) running.uom = uom
    } else {
      totals.set(key, { itemCode, itemName, uom, qty: Number.isFinite(qty) ? qty : 0 })
    }
  }

  for (const item of binlessItems) {
    const itemCode = String(item.itemCode ?? '')
    const itemName = String(item.itemName ?? '') || itemCode
    if (!itemCode && !itemName) continue
    const key = totalsKey(itemCode, itemName)
    // Never overwrite a line built from bins. The server excludes anything with a bin
    // row, but a duplicate arriving here must lose to the real total, not flatten it.
    if (totals.has(key)) continue
    const qty = Number(item.qty ?? 0)
    totals.set(key, {
      itemCode,
      itemName,
      uom: String(item.uom ?? ''),
      qty: Number.isFinite(qty) ? qty : 0,
    })
  }

  return [...totals.values()].sort(
    (a, b) => a.itemName.localeCompare(b.itemName) || a.itemCode.localeCompare(b.itemCode)
  )
}
