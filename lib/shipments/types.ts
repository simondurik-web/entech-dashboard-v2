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
}

export interface DailyRollupRow {
  day: string
  source_system: string | null
  part_number: string | null
  service: string | null
  units: NumericValue
  lines: NumericValue
  orders: NumericValue
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

export type DeliverableKind = 'packing-fedex' | 'packing-ltl' | 'labels' | 'summary' | 'other'

export interface DeliverableFile {
  name: string
  path: string
  size: number | null
  kind: DeliverableKind
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
