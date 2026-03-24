export interface LabelData {
  id?: string
  order_line: string
  customer_name: string
  part_number: string
  order_qty: number
  parts_per_package: number
  num_packages: number
  packaging_type?: string
  pallet_number?: number
  qr_data?: string
  label_status: 'pending' | 'generated' | 'emailed' | 'printed' | 'error'
  // Product details (for label printout)
  tire?: string
  hub?: string
  hub_style?: string
  bearings?: string
  po_number?: string
  if_number?: string
  // Tracking
  assigned_to?: string
  generated_by?: string
  generated_at?: string
  emailed_to?: string[]
  emailed_at?: string
  printed_by?: string
  printed_at?: string
  error_message?: string
  created_at?: string
  updated_at?: string
}

/**
 * Generate QR deep-link URL for the Entech Production App.
 * Pattern matches the Google Sheets label script:
 *   https://entech-production-app.vercel.app/scan?line=2922&pallet=1&total=2
 */
export function generateQrData(line: string, _customer: string, _part: string, pallet?: number, totalPallets?: number): string {
  const params = new URLSearchParams()
  params.set('line', line)
  if (pallet != null) params.set('pallet', String(pallet))
  if (totalPallets != null) params.set('total', String(totalPallets))
  return `https://entech-production-app.vercel.app/scan?${params.toString()}`
}

export function calculatePackages(orderQty: number, perPackage: number): { numPackages: number; lastPackageQty: number } {
  if (perPackage <= 0) return { numPackages: 0, lastPackageQty: 0 }
  const numPackages = Math.ceil(orderQty / perPackage)
  const remainder = orderQty % perPackage
  const lastPackageQty = remainder === 0 ? perPackage : remainder
  return { numPackages, lastPackageQty }
}

export function validateLabelData(order: {
  order_line?: string
  customer_name?: string
  part_number?: string
  order_qty?: number
  parts_per_package?: number
}): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!order.order_line) errors.push('Order line is required')
  if (!order.customer_name) errors.push('Customer name is required')
  if (!order.part_number) errors.push('Part number is required')
  if (!order.order_qty || order.order_qty <= 0) errors.push('Order quantity must be greater than 0')
  if (!order.parts_per_package || order.parts_per_package <= 0) errors.push('Parts per package must be greater than 0')

  return { valid: errors.length === 0, errors }
}

export function getLabelStatusColor(status: string): string {
  switch (status) {
    case 'pending': return 'bg-yellow-500/20 text-yellow-600'
    case 'generated': return 'bg-blue-500/20 text-blue-600'
    case 'emailed': return 'bg-purple-500/20 text-purple-600'
    case 'printed': return 'bg-green-500/20 text-green-600'
    case 'error': return 'bg-red-500/20 text-red-600'
    default: return 'bg-muted text-muted-foreground'
  }
}
