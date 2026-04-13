export interface ShippingOverviewPallet {
  id?: string
  palletNumber: string
  weight: number
  weightDisplay: string
  dimensions: string
  photos: string[]
  source: 'sheet' | 'app'
}

export interface ShippingOverviewShippingRecord {
  shipDate: string
  carrier: string
  bol: string
  shipmentPhotos: string[]
  paperworkPhotos: string[]
  closeUpPhotos: string[]
}

export interface ShippingOverviewSummaryStats {
  stagedOrders: number
  stagedRevenue: number
  stagedUnits: number
  shippedOrders: number
  shippedRevenue: number
  shippedUnits: number
  totalRevenue: number
  totalUnits: number
}

export interface ShippingOverviewOrder {
  line: string
  ifNumber: string
  poNumber: string
  customer: string
  category: string
  partNumber: string
  status: 'staged' | 'shipped'
  orderQty: number
  revenue: number
  requestedDate: string
  shippedDate: string
  daysUntilDue: number | null
  shipToAddress: string
  shippingNotes: string
  internalNotes: string
  shippingCost: number
  pallets: ShippingOverviewPallet[]
  palletCount: number
  palletPhotoCount: number
  totalPalletWeight: number
  dimensionsSummary: string
  shipping: ShippingOverviewShippingRecord | null
  shippingPhotoCount: number
  // Pallet calculator enrichment (extracted from pallets array)
  palletWidth?: number
  palletLength?: number
  palletWeightEach?: number
}

export interface ShippingOverviewResponse {
  staged: ShippingOverviewOrder[]
  shipped: ShippingOverviewOrder[]
  stats: ShippingOverviewSummaryStats
  generatedAt: string
}
