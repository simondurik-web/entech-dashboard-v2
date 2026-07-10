/**
 * Shared types and utilities from google-sheets that are safe for client components.
 * Server-only fetch functions remain in google-sheets.ts.
 */

export function normalizeStatus(status: string, ifStatus: string): string {
  const s = (status || ifStatus || '').toLowerCase()
  
  // Canceled/cancelled orders - explicit check
  if (s.includes('cancel')) return 'cancelled'
  if (s.includes('closed') || s.includes('void')) return 'cancelled'
  
  // Standard statuses (order matters — check more specific first)
  if (s.includes('pending') || s.includes('approved') || s.includes('released')) return 'pending'
  if (s.includes('completed')) return 'completed'
  // "Loaded" = shipping's post-staging step (IF loaded on the trailer,
  // Simon 2026-06-11) — the order is physically ready to ship.
  if (s.includes('staged') || s.includes('loaded')) return 'staged'
  if (s.includes('work in progress') || s.includes('wip') || s.includes('in production')) return 'wip'
  if (s.includes('shipped') || s.includes('invoiced') || s.includes('to bill')) return 'shipped'
  
  // If no match, return the original (lowercased) or 'unknown'
  return s || 'unknown'
}

// ---- Exported types from google-sheets ----

export interface Order {
  line: string
  category: string
  dateOfRequest: string
  priorityLevel: number
  urgentOverride: boolean
  ifNumber: string
  ifStatus: string
  internalStatus: string
  poNumber: string
  customer: string
  partNumber: string
  orderQty: number
  packaging: string
  partsPerPackage: number
  numPackages: number
  fusionInventory: number
  hubMold: string
  tire: string
  hasTire: boolean
  hub: string
  hasHub: boolean
  bearings: string
  requestedDate: string
  daysUntilDue: number | null
  assignedTo: string
  shippedDate: string
  dailyCapacity: number
  // Priority override (manual from dashboard)
  priorityOverride: string | null
  priorityChangedBy: string | null
  priorityChangedAt: string | null
  // Computed priority (set after fetch)
  computedPriority?: string | null
  // Ship-to shipping address (optional column; from dashboard_orders.ship_to_address)
  shipToAddress?: string
  // Pallet calculator enrichment (from pallet records)
  palletWidth?: number
  palletLength?: number
  palletWeightEach?: number
  // Customer's own part number for this line (from customer_part_mappings,
  // keyed by customer + internal partNumber). Shown on the pallet load report.
  customerPartNumber?: string
  // True when this row comes from the pre-ERPNext Google-Sheet archive
  // (dashboard_orders_fusion_archive), surfaced read-only in Orders Data search.
  archived?: boolean
}

export interface InventoryHistoryPart {
  partNumber: string
  dataByDate: Record<string, number>
}

export interface InventoryHistoryData {
  dates: string[]
  parts: InventoryHistoryPart[]
}

export interface InventoryItem {
  partNumber: string
  product: string
  /** AVAILABLE stock (on hand minus committed) — the planning number every
   *  calculation uses; committed stock never counts toward other orders. */
  inStock: number
  /** Physical on-hand total from ERPNext. */
  onHand: number
  /** Reserved to sales orders (ERPNext stock reservations). */
  committed: number
  minimum: number
  moldType: string
  lastUpdate: string
  itemType: string          // "Manufactured" | "Purchased" | "COM" | ""
  isManufactured: boolean
  projectionRate: number | null  // avg daily usage/production rate
  usage7: number | null     // 7-day usage
  usage30: number | null    // 30-day usage
  daysToMin: number | null  // days until stock hits minimum
  daysToZero: number | null // days until stock hits zero
  department?: string       // from inventory_reference — non-sensitive, sent to all users
  subDepartment?: string    // from inventory_reference — non-sensitive, sent to all users
}

export interface ProductionMakeItem {
  partNumber: string
  product: string
  moldType: string
  /** AVAILABLE stock (on hand minus committed-to-SO). */
  fusionInventory: number
  /** Physical on-hand total from ERPNext. */
  onHand: number
  /** Reserved to sales orders (shown next to Available). */
  committed: number
  minimums: number
  /** Total qty required by open (pending/WIP, unshipped) orders using this part. */
  neededOpenOrders: number
  partsToBeMade: number
  drawingUrl: string
}

export interface PalletRecord {
  id?: string
  timestamp: string
  orderNumber: string
  lineNumber: string
  palletNumber: string
  customer: string
  ifNumber: string
  category: string
  weight: string
  dimensions: string
  partsPerPallet: string
  photos: string[]
  _source?: 'sheet' | 'app'
  length?: number | null
  width?: number | null
  height?: number | null
  order_id?: string
  edited_by_name?: string
  edited_at?: string
  shipmentPhotos?: string[]
  workPaperPhotos?: string[]
}

export interface ShippingRecord {
  timestamp: string
  shipDate: string
  customer: string
  ifNumber: string
  /** dashboard line the shipment covered — scopes photos to ONE release of a
   *  multi-release SO (empty on legacy rows recorded before line capture) */
  lineNumber?: string
  category: string
  carrier: string
  bol: string
  palletCount: number
  photos: string[]
  shipmentPhotos: string[]
  paperworkPhotos: string[]
  closeUpPhotos: string[]
}

export interface StagedRecord {
  timestamp: string
  ifNumber: string
  customer: string
  partNumber: string
  category: string
  quantity: number
  location: string
  photos: string[]
  fusionPhotos: string[]
}

export interface Drawing {
  partNumber: string
  product: string
  productType: 'Tire' | 'Hub' | 'Other'
  drawingUrls: string[]
  moldType: string
}

export interface BOMComponent {
  partNumber: string
  description: string
  quantity: number
  unit: string
  costPerUnit: number
  category: 'raw' | 'component' | 'packaging' | 'energy' | 'assembly'
}

export interface BOMItem {
  partNumber: string
  product: string
  category: string
  qtyPerPallet: number
  components: BOMComponent[]
  totalCost: number
  materialCost: number
  packagingCost: number
  laborEnergyCost: number
}

