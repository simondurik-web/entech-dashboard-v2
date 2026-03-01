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
  if (s.includes('staged')) return 'staged'
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
  // Pallet calculator enrichment (from pallet records)
  palletWidth?: number
  palletLength?: number
  palletWeightEach?: number
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
  inStock: number
  minimum: number
  target: number
  moldType: string
  lastUpdate: string
  itemType: string          // "Manufactured" | "Purchased" | "COM" | ""
  isManufactured: boolean
  projectionRate: number | null  // avg daily usage/production rate
  usage7: number | null     // 7-day usage
  usage30: number | null    // 30-day usage
  daysToMin: number | null  // days until stock hits minimum
  daysToZero: number | null // days until stock hits zero
}

export interface ProductionMakeItem {
  partNumber: string
  product: string
  moldType: string
  fusionInventory: number
  minimums: number
  partsToBeMade: number
  drawingUrl: string
}

export interface PalletRecord {
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
}

export interface ShippingRecord {
  timestamp: string
  shipDate: string
  customer: string
  ifNumber: string
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

