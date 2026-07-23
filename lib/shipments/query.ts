import { etRangeToDates, isRealDate } from './et-date'
import type { ShipmentRow } from './types'

// Shared between the explorer and export routes so the exported file can never
// diverge from the filtered table the user is looking at.

export const SHIPMENT_COLUMNS =
  'id,run_id,sent_at,po_number,partner,ship_to_name,ship_to_address,city,state,zip,residential,service,source_system,tracking,part_number,qty'

export const LTL_SERVICE = 'LTL (set-aside)'

export interface ShipmentFilters {
  q: string
  part: string
  from: string | null
  to: string | null
  source: string | null
  service: string | null
  residential: boolean | null
  ltlOnly: boolean
}

export function escapedLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/** PostgREST or() operand: double-quoted so commas/parens in user input can't
 *  split the expression list. */
export function quotedOrPattern(value: string): string {
  const escaped = escapedLikeValue(value).replace(/"/g, '\\"')
  return `"%${escaped}%"`
}

/** Validate + parse the shared filter query params. Returns null on invalid input. */
export function parseShipmentFilters(params: URLSearchParams): ShipmentFilters | null {
  const from = params.get('from')
  const to = params.get('to')
  const residentialParam = params.get('residential')
  const ltlParam = params.get('ltl')
  if (
    (from !== null && !isRealDate(from)) ||
    (to !== null && !isRealDate(to)) ||
    (from !== null && to !== null && from > to) ||
    (residentialParam !== null && residentialParam !== 'true' && residentialParam !== 'false') ||
    (ltlParam !== null && ltlParam !== '1')
  ) {
    return null
  }

  return {
    // Length caps: parameterized (no injection), but unbounded ilike patterns
    // are needless PostgREST load.
    q: (params.get('q')?.trim() ?? '').slice(0, 200),
    part: (params.get('part')?.trim() ?? '').slice(0, 200),
    from,
    to,
    source: params.get('source')?.trim() || null,
    service: params.get('service')?.trim() || null,
    residential: residentialParam === null ? null : residentialParam === 'true',
    ltlOnly: ltlParam === '1',
  }
}

// Structural slice of PostgrestFilterBuilder — just the chainable methods the
// filters use, so both the counted (explorer) and plain (export) selects pass
// through without fighting the builder's version-specific generics.
interface FilterChain {
  or(filters: string): this
  ilike(column: string, pattern: string): this
  gte(column: string, value: string): this
  lt(column: string, value: string): this
  eq(column: string, value: string | boolean): this
}

export function applyShipmentFilters<T>(query: T, filters: ShipmentFilters): T {
  // Opaque generic + internal cast: constraining T against the supabase builder
  // type trips TS2589 (excessively deep instantiation) on its recursive generics.
  let q = query as unknown as FilterChain
  if (filters.q) {
    const pattern = quotedOrPattern(filters.q)
    q = q.or([
      `ship_to_name.ilike.${pattern}`,
      `ship_to_address.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `state.ilike.${pattern}`,
      `zip.ilike.${pattern}`,
    ].join(','))
  }
  if (filters.part) q = q.ilike('part_number', `%${escapedLikeValue(filters.part)}%`)
  if (filters.from) {
    const bounds = etRangeToDates(filters.from, filters.from)
    q = q.gte('sent_at', bounds.from.toISOString())
  }
  if (filters.to) {
    const bounds = etRangeToDates(filters.to, filters.to)
    q = q.lt('sent_at', bounds.toExclusive.toISOString())
  }
  if (filters.source) q = q.eq('source_system', filters.source)
  if (filters.service) q = q.eq('service', filters.service)
  if (filters.residential !== null) q = q.eq('residential', filters.residential)
  if (filters.ltlOnly) q = q.eq('service', LTL_SERVICE)
  return q as unknown as T
}

export function normalizeShipmentRow(row: Record<string, unknown>): ShipmentRow {
  const qty = Number(row.qty)
  return {
    id: String(row.id),
    run_id: row.run_id == null ? null : String(row.run_id),
    sent_at: String(row.sent_at),
    po_number: row.po_number == null ? null : String(row.po_number),
    partner: row.partner == null ? null : String(row.partner),
    ship_to_name: row.ship_to_name == null ? null : String(row.ship_to_name),
    ship_to_address: row.ship_to_address == null ? null : String(row.ship_to_address),
    city: row.city == null ? null : String(row.city),
    state: row.state == null ? null : String(row.state),
    zip: row.zip == null ? null : String(row.zip),
    residential: typeof row.residential === 'boolean' ? row.residential : null,
    service: row.service == null ? null : String(row.service),
    source_system: row.source_system == null ? null : String(row.source_system),
    tracking: row.tracking == null ? null : String(row.tracking),
    part_number: row.part_number == null ? null : String(row.part_number),
    qty: Number.isFinite(qty) ? qty : 0,
  }
}
