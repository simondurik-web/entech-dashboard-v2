import 'server-only'

import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Photo-completeness gate for the Production -> Shipping hand-off.
 *
 * Since the Fusion->ERPNext migration, an order's sheet status flips to
 * "Staged" automatically the moment shipping labels are created. That used to
 * yank the order straight out of the Pallet Records "Production" list and into
 * "Shipping" before anyone could photograph the pallets. This gate keeps a
 * Staged order in Production until every expected pallet has a valid photo
 * (or an admin explicitly forces it), regardless of what ERPNext says.
 *
 * "Photographed" = a real pallet row (pallet_number != 0) in `pallet_records`
 * that has at least one non-empty photo URL. Distinct pallet numbers are
 * counted, so re-saving the same pallet never inflates the total.
 *
 * Everything here is read via the service-role client only.
 */
export type StagingGate = {
  /** Distinct pallets (pallet_number != 0) that have at least one valid photo. */
  photographed: number
  /** True when an admin used "Force to Shipping" to override the photo gate. */
  forced: boolean
}

const EMPTY_GATE: StagingGate = { photographed: 0, forced: false }

function normalizeLines(lineNumbers: string[]): string[] {
  return Array.from(
    new Set(lineNumbers.map((l) => String(l ?? '').trim()).filter(Boolean))
  )
}

/**
 * For each line number, count photographed pallets and note any admin
 * force-to-shipping override. Lines with no pallet data return a zeroed gate.
 */
export async function getStagingGates(
  lineNumbers: string[]
): Promise<Record<string, StagingGate>> {
  const lines = normalizeLines(lineNumbers)
  const result: Record<string, StagingGate> = Object.fromEntries(
    lines.map((l) => [l, { photographed: 0, forced: false }])
  )
  if (lines.length === 0) return result

  const [pallets, overrides] = await Promise.all([
    supabaseAdmin
      .from('pallet_records')
      .select('line_number, pallet_number, photo_urls')
      .in('line_number', lines),
    // Tolerate the overrides table not existing yet (pre-migration deploy):
    // a failure just means "no forced orders", never a broken pallet section.
    supabaseAdmin
      .from('pallet_shipping_overrides')
      .select('line_number')
      .in('line_number', lines)
      .then((r) => r, () => ({ data: [], error: null })),
  ])

  // Distinct photographed pallet numbers per line.
  const photographed: Record<string, Set<number>> = {}
  for (const row of pallets.data || []) {
    const line = String(row.line_number ?? '').trim()
    if (!(line in result)) continue
    // Coerce with Number() — supabase-js can return numeric columns as strings,
    // and the order-level row (pallet_number 0) must never count as a pallet.
    const pnum = Number(row.pallet_number)
    if (!Number.isFinite(pnum) || pnum === 0) continue
    const urls = Array.isArray(row.photo_urls) ? row.photo_urls : []
    const hasPhoto = urls.some((u: unknown) => typeof u === 'string' && u.trim().length > 0)
    if (!hasPhoto) continue
    ;(photographed[line] ??= new Set()).add(pnum)
  }
  for (const [line, set] of Object.entries(photographed)) {
    result[line].photographed = set.size
  }

  for (const row of overrides.data || []) {
    const line = String(row.line_number ?? '').trim()
    if (line in result) result[line].forced = true
  }

  return result
}

/**
 * A Staged order is ready to move to Shipping only when every expected pallet
 * has been photographed, or an admin has forced it.
 *
 * When the expected pallet count is unknown (0/blank in the sheet) we HOLD the
 * order in Production rather than let it slip to Shipping with no photos —
 * "there should always be a pallet picture" (Simon, 2026-07-02). The admin
 * "Force to Shipping" button is the deliberate escape hatch for that case, so
 * such an order can never be trapped forever.
 */
export function isReadyForShipping(
  numPallets: number,
  gate: StagingGate | undefined = EMPTY_GATE
): boolean {
  if (gate?.forced) return true
  if (!numPallets || numPallets <= 0) return false
  return (gate?.photographed || 0) >= numPallets
}
