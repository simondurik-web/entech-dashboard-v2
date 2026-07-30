export type NumericValue = number | string | null

export interface ShipmentRow {
  id: string
  run_id: string | null
  sent_at: string
  po_number: string | null
  partner: string | null
  ship_to_name: string | null
  ship_to_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  residential: boolean | null
  service: string | null
  source_system: string | null
  tracking: string | null
  part_number: string | null
  qty: number
  /** Cost of the whole shipment, carried on exactly ONE row per
   *  (run_id, po_number) — the lowest part_number line — and NULL on the
   *  shipment's other line rows. NULL also means "never captured" (most
   *  historical runs), so it must render blank, never $0.00. */
  shipping_cost_usd: number | null
}

export interface DailyRollupRow {
  day: string
  source_system: string | null
  part_number: string | null
  service: string | null
  units: NumericValue
  lines: NumericValue
  orders: NumericValue
  /** SUM(shipping_cost_usd) for the group — optional because the deployed
   *  shipment_daily_rollup RPC does not emit it yet; absent/NULL means "no
   *  priced shipments in this group", never zero-cost. */
  shipping_cost_usd?: NumericValue
  /** COUNT(shipping_cost_usd) for the group — the number of priced shipments
   *  (cost lives on one row per shipment). Optional for the same reason. */
  priced_orders?: NumericValue
}

/** Per-day distinct PO counts (shipment_daily_orders RPC) — the per-part rollup's
 *  orders column double-counts POs spanning multiple parts, so order totals come
 *  from these rows instead whenever they are provided. */
export interface DailyOrdersRow {
  day: string
  source_system: string | null
  orders: NumericValue
}

export interface ShipmentTotals {
  units: number
  lines: number
  orders: number
  /** Sum of the priced shipments' costs only — a PARTIAL figure whenever
   *  pricedOrders < orders. Consumers must surface pricedOrders alongside it
   *  (or omit the total when pricedOrders is 0), never present it as the
   *  complete spend. */
  cost: number
  /** How many shipments in this total actually carry a cost. */
  pricedOrders: number
}

export interface SourceSummary {
  today: ShipmentTotals
  thisWeek: ShipmentTotals
}

export interface ShipmentSummary {
  today: ShipmentTotals
  thisWeek: ShipmentTotals
  bySource: Record<string, SourceSummary>
  ltl: {
    today: number
    thisWeek: number
  }
  latestDay: string | null
}

export type VolumeBucketSize = 'day' | 'week' | 'month' | 'quarter' | 'year'

export interface VolumeBucket extends ShipmentTotals {
  bucket: string
  bySource: Record<string, ShipmentTotals>
  parts: Record<string, number>
}

export type DeliverableKind =
  | 'packing-fedex'
  | 'packing-ltl'
  | 'packing-ups'
  | 'labels'
  | 'summary'
  | 'other'

/** Which shipping automation produced the file — a separate axis from kind
 *  (kind says what the document is and drives printer choice; partner says
 *  whose orders it covers). */
export type DeliverablePartner = 'home-depot' | 'amazon' | 'unknown'

export interface DeliverableFile {
  name: string
  path: string
  size: number | null
  kind: DeliverableKind
  partner: DeliverablePartner
}

export interface ShipmentFacets {
  sources: string[]
  services: string[]
}

export interface ShipmentFacetFilters {
  source: string | null
  service: string | null
  residential: boolean | null
  ltlOnly: boolean
}
