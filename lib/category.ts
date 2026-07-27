/**
 * Product-category classification for the dashboard's filter chips.
 *
 * Pure domain logic, deliberately kept out of the `'use client'` component so it
 * can be reasoned about and exercised on its own. `components/category-filter.tsx`
 * re-exports everything here, so existing imports keep working either way.
 */

export const CATEGORY_KEYS = ['rolltech', 'molding', 'snappad', 'technoflex'] as const
export type CategoryKey = (typeof CATEGORY_KEYS)[number]

/** Accepted Technoflex customer names, normalized. Simon 2026-07-26: match the
 *  ENTIRE customer name as displayed on the dashboard, not a loose substring.
 *  A name variant that is not listed here must be ADDED here — see the near-miss
 *  warning in classifyCategory, which exists so drift is loud instead of silent. */
const TECHNOFLEX_CUSTOMERS = ['technoflex intl inc']

/** lowercase, punctuation → single spaces, trimmed. Absorbs the trailing-space and
 *  trailing-period drift this DB demonstrably has (e.g. 'Ken-way corporación '). */
function normalizeCustomer(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Buckets a row into exactly one category.
 *
 *  Order matters. Technoflex is tested FIRST because every Technoflex row carries
 *  category="Molding " in the DB — it is carved out by customer name, the same way
 *  Snap Pad is already carved out by its own category value. That is what makes
 *  the "Molding" chip mean the quiet list.
 *
 *  The customer test is an EXACT match on the normalized full name (Simon's call).
 *  The category tests are deliberately substring + toLowerCase, because the real DB
 *  values are dirty: 'Molding ' with a trailing space and 'Roll tech' with a
 *  lowercase t both occur in thousands of live rows.
 */
export function classifyCategory(
  row: { category?: string | null; customer?: string | null }
): CategoryKey | 'other' {
  const customer = normalizeCustomer(row.customer)
  if (TECHNOFLEX_CUSTOMERS.includes(customer)) return 'technoflex'
  // Make name drift loud. A row that looks like Technoflex but does not match the
  // accepted list would otherwise be silently filed under Molding.
  // NOTE: 'Hypervac Technologies Inc' contains 'techno' but NOT 'technoflex' — it
  // must not trip this warning, which is why the test is on the longer token.
  if (process.env.NODE_ENV !== 'production' && customer.includes('technoflex')) {
    console.warn(
      `[category] Unrecognized Technoflex customer name: ${JSON.stringify(row.customer)} — ` +
      `add its normalized form to TECHNOFLEX_CUSTOMERS or it will be counted as Molding.`
    )
  }
  const cat = (row.category ?? '').toLowerCase()
  if (cat.includes('snap')) return 'snappad'
  if (cat.includes('molding')) return 'molding'
  if (cat.includes('roll')) return 'rolltech'
  return 'other'
}

/** The chips a page actually shows. Pages without a per-row `customer` (material
 *  requirements are BOM aggregates) cannot classify Technoflex, so they hide that
 *  chip — and must then treat "3 selected" as the All state. Deriving the count
 *  from this keeps the two in lockstep instead of hard-coding a 3 or a 4. */
export function visibleCategoryKeys(showTechnoflex: boolean): readonly CategoryKey[] {
  return showTechnoflex ? CATEGORY_KEYS : CATEGORY_KEYS.filter((key) => key !== 'technoflex')
}

/**
 * @param totalKeys how many chips the caller renders. Pass
 *        `visibleCategoryKeys(false).length` when the Technoflex chip is hidden,
 *        otherwise "all selected" is never detected and `other` rows get dropped.
 */
export function filterByCategory<T extends { category?: string | null; customer?: string | null }>(
  data: T[],
  selected: readonly CategoryKey[],
  totalKeys: number = CATEGORY_KEYS.length
): T[] {
  // "All" bypasses entirely so `other` rows (blank / "Part number missing…") stay visible.
  if (selected.length === 0 || selected.length === totalKeys) return data
  return data.filter((row) => selected.includes(classifyCategory(row) as CategoryKey))
}

export const DEFAULT_CATEGORIES: CategoryKey[] = [...CATEGORY_KEYS]
