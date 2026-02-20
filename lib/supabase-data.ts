/**
 * Supabase data layer — drop-in replacement for google-sheets.ts fetch functions.
 * Returns the SAME types so API routes and pages don't need changes.
 */
import { supabase } from './supabase'
import {
  type Order,
  type InventoryItem,
  type ProductionMakeItem,
  type Drawing,
  normalizeStatus,
} from './google-sheets'

// Re-export types so API routes can import from either module
export type { Order, InventoryItem, ProductionMakeItem, Drawing }
export { normalizeStatus }

// ─── Sales types (defined in sales/route.ts, duplicated here) ───
export interface SalesOrder {
  line: string
  customer: string
  partNumber: string
  category: string
  qty: number
  revenue: number
  variableCost: number
  totalCost: number
  pl: number
  shippedDate: string
  status: string
}

export interface SalesSummary {
  totalRevenue: number
  totalCosts: number
  totalPL: number
  avgMargin: number
  orderCount: number
}

export interface SalesData {
  orders: SalesOrder[]
  summary: SalesSummary
}

// ─── Helper ───

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  // Strip $, commas, spaces, and handle parenthetical negatives like ($1,234.56)
  let s = String(v).replace(/[$,\s]/g, '')
  if (s.startsWith('(') && s.endsWith(')')) s = '-' + s.slice(1, -1)
  const n = Number(s)
  return isNaN(n) ? 0 : n
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  const s = str(v).toLowerCase()
  return ['true', '1', 'yes'].includes(s)
}

function getCategory(cat: string): string {
  const lower = cat.toLowerCase().trim()
  if (lower.includes('roll tech')) return 'Roll Tech'
  if (lower.includes('molding')) return 'Molding'
  if (lower.includes('snap pad') || lower.includes('snap-pad') || lower.includes('snappad')) return 'Snap Pad'
  // "Part number missing..." rows are mostly Roll Tech parts
  if (lower.includes('missing') || lower.includes('reference data')) return 'Roll Tech'
  return 'Other'
}

// ─── Orders (dashboard_orders table) ───

async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  // PostgREST caps at 1000 rows by default — paginate to get all
  const allRows: Record<string, unknown>[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Supabase ${table} error: ${error.message}`)
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

export async function fetchOrdersFromDB(): Promise<Order[]> {
  const data = await fetchAllRows('dashboard_orders')
  if (!data.length) return []

  return data
    .map((row): Order => ({
      line: str(row.line),
      category: str(row.category),
      dateOfRequest: str(row.date_of_request),
      priorityLevel: num(row.priority_level),
      urgentOverride: bool(row.urgent_override),
      ifNumber: str(row.if_number),
      ifStatus: str(row.if_status_fusion),
      internalStatus: str(row.work_order_status),
      poNumber: str(row.po_number),
      customer: str(row.customer),
      partNumber: str(row.part_number),
      orderQty: num(row.order_qty),
      packaging: str(row.packaging),
      partsPerPackage: num(row.parts_per_package),
      numPackages: num(row.number_of_packages),
      fusionInventory: num(row.fusion_inventory),
      hubMold: str(row.hub_mold),
      tire: str(row.tire),
      hasTire: bool(row.have_tire),
      hub: str(row.hub),
      hasHub: bool(row.have_hub),
      bearings: str(row.bearings),
      requestedDate: str(row.requested_completion_date),
      daysUntilDue: num(row.days_until_promise) || null,
      shippedDate: str(row.shipped_date),
      assignedTo: str(row.assigned_to),
    }))
    .filter((o) => o.line && o.customer)
    .filter((o) => {
      const status = normalizeStatus(o.internalStatus, o.ifStatus)
      return status !== 'cancelled'
    })
}

// ─── All Data (dashboard_orders, all columns as key-value) ───

export async function fetchAllDataFromDB(): Promise<Record<string, string>[]> {
  const data = await fetchAllRows('dashboard_orders')
  if (!data.length) return []

  // Convert snake_case DB columns → human-readable headers (matching Sheet headers)
  const colMap: Record<string, string> = {
    line: 'Line',
    category: 'Category',
    date_of_request: 'Date of Request',
    priority_level: 'Priority Level',
    urgent_override: 'Urgent Override',
    if_number: 'IF #',
    if_status_fusion: 'IF Status in Fusion',
    work_order_status: 'Work order Internal Status',
    po_number: 'PO #',
    customer: 'Customer',
    part_number: 'Part #',
    enough_inventory: 'Enought inventory for current order',
    fusion_inventory: 'Fusion inventory',
    cumulative_demand: 'Cummulative demand for the item',
    order_qty: 'Order Qty',
    packaging: 'Packaging',
    parts_per_package: 'Parts per package',
    number_of_packages: 'Number of packages',
    est_weight_per_pallet: 'Estimated weight per pallet',
    est_weight_for_order: 'Estimated weight for the order',
    daily_capacity: 'Daily Capacity',
    requested_completion_date: 'Requested Completion Date',
    days_until_promise: 'Days until promise date.',
    weight: 'Weight',
    dimensions: 'Dimensions',
    tire: 'Tire',
    have_tire: 'Have Tire?',
    total_tire_inventory: 'Total tire inventory',
    tire_cumulative_demand: 'Tire Cumulative demand',
    hub: 'Hub',
    have_hub: 'Have Hub?',
    total_hub_inventory: 'Total hub inventory',
    hub_cumulative_demand: 'Hub Cumulative demand',
    hub_style: 'Hub Style',
    hub_mold: 'Hub Mold',
    bearings: 'Bearings',
    unit_price: 'Unit Price',
    contribution_level: 'Contribution Level',
    variable_cost: 'Variable Cost',
    total_cost: 'Total Cost',
    sales_target_20: 'Sales Target with 20%',
    profit_per_part: 'Profit per part',
    pl: 'P/L',
    revenue: 'Revenue',
    shipped_date: 'Shipped Date',
    printed_by: 'Printed by:',
    assigned_to: 'Assigned to:',
    date_assigned: 'Date assigned',
    ship_to_address: 'shipToAddress',
    bill_to_address: 'billToAddress',
    customer_number: 'customerNumber',
    min_inventory_target: 'Minimum inventory Target',
    shipping_notes: 'shippingNotes',
    picking_notes: 'pickingNotes',
    internal_notes: 'internalNotes',
    shipping_cost: 'shippingCost',
  }

  return data.map((row) => {
    const obj: Record<string, string> = {}
    for (const [dbCol, header] of Object.entries(colMap)) {
      obj[header] = str(row[dbCol])
    }
    return obj
  }).filter((o) => o['Line'] && o['Customer'])
}

// ─── Inventory (inventory + production_totals tables) ───

export async function fetchInventoryFromDB(): Promise<InventoryItem[]> {
  const [inventoryRes, productionRes] = await Promise.all([
    supabase.from('inventory').select('*'),
    supabase.from('production_totals').select('*'),
  ])

  if (inventoryRes.error) throw new Error(`Supabase inventory error: ${inventoryRes.error.message}`)
  if (productionRes.error) throw new Error(`Supabase production error: ${productionRes.error.message}`)

  // Build Fusion map: partNumber -> qty
  const fusionMap = new Map<string, number>()
  for (const row of inventoryRes.data || []) {
    const part = str(row.item_number).trim()
    if (part) fusionMap.set(part.toUpperCase(), num(row.real_number_value))
  }

  const items: InventoryItem[] = []
  for (const row of productionRes.data || []) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    const product = str(row.product).trim()
    const minimum = num(row.minimums) || num(row.quantity_needed)
    const target = num(row.manual_target)
    const moldType = str(row.mold_type)

    // Look up stock from Fusion
    const key = partNumber.toUpperCase()
    let inStock = fusionMap.get(key)
    if (inStock === undefined) {
      for (const [fusionKey, qty] of fusionMap) {
        if (fusionKey.startsWith(key)) {
          inStock = qty
          break
        }
      }
    }

    // Parse Make/Purchased/Com
    const makePurchasedRaw = str(row.make_purchased_com).toLowerCase().trim()
    let itemType = ''
    let isManufactured = false
    if (makePurchasedRaw.includes('make') || makePurchasedRaw.includes('manufactured')) {
      itemType = 'Manufactured'
      isManufactured = true
    } else if (makePurchasedRaw.includes('purchased')) {
      itemType = 'Purchased'
    } else if (makePurchasedRaw.includes('com')) {
      itemType = 'COM'
    }

    const stock = inStock ?? 0
    const dailyUsage = minimum > 0 ? minimum / 30 : null
    const daysToMin = dailyUsage && dailyUsage > 0 && stock > minimum
      ? Math.round((stock - minimum) / dailyUsage)
      : (stock <= minimum && minimum > 0 ? 0 : null)
    const daysToZero = dailyUsage && dailyUsage > 0 ? Math.round(stock / dailyUsage) : null

    items.push({
      partNumber, product, inStock: stock, minimum, target, moldType, lastUpdate: '',
      itemType, isManufactured,
      projectionRate: dailyUsage,
      usage7: null, usage30: null,
      daysToMin, daysToZero,
    })
  }

  return items
}

// ─── Production Make ───

export async function fetchProductionMakeFromDB(): Promise<ProductionMakeItem[]> {
  const [inventoryRes, productionRes] = await Promise.all([
    supabase.from('inventory').select('*'),
    supabase.from('production_totals').select('*'),
  ])

  if (inventoryRes.error) throw new Error(`Supabase inventory error: ${inventoryRes.error.message}`)
  if (productionRes.error) throw new Error(`Supabase production error: ${productionRes.error.message}`)

  const fusionMap = new Map<string, number>()
  for (const row of inventoryRes.data || []) {
    const part = str(row.item_number).trim()
    if (part) fusionMap.set(part.toUpperCase(), num(row.real_number_value))
  }

  const items: ProductionMakeItem[] = []
  for (const row of productionRes.data || []) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    const minimums = num(row.minimums) || num(row.quantity_needed)
    const key = partNumber.toUpperCase()
    let fusionInventory = fusionMap.get(key)
    if (fusionInventory === undefined) {
      for (const [fusionKey, qty] of fusionMap) {
        if (fusionKey.startsWith(key)) {
          fusionInventory = qty
          break
        }
      }
    }
    fusionInventory = fusionInventory ?? 0

    const partsToBeMade = Math.max(0, minimums - fusionInventory)

    if (partsToBeMade > 0 || minimums > 0) {
      items.push({
        partNumber,
        product: str(row.product).trim(),
        moldType: str(row.mold_type),
        fusionInventory,
        minimums,
        partsToBeMade,
        drawingUrl: '',
      })
    }
  }

  return items.sort((a, b) => b.partsToBeMade - a.partsToBeMade)
}

// ─── Sales ───

export async function fetchSalesFromDB(): Promise<SalesData> {
  const data = await fetchAllRows('dashboard_orders')
  if (!data.length) return { orders: [], summary: { totalRevenue: 0, totalCosts: 0, totalPL: 0, avgMargin: 0, orderCount: 0 } }

  const orders: SalesOrder[] = []
  let totalRevenue = 0
  let totalCosts = 0
  let totalPL = 0

  for (const row of data) {
    const line = str(row.line)
    const customer = str(row.customer)
    if (!line || !customer) continue

    const status = normalizeStatus(str(row.work_order_status), str(row.if_status_fusion))
    if (status === 'cancelled' || status !== 'shipped') continue

    const revenue = num(row.revenue)
    const variableCost = num(row.variable_cost)
    const totalCost = num(row.total_cost)
    const pl = num(row.pl)

    if (revenue === 0 && pl === 0) continue

    orders.push({
      line,
      customer,
      partNumber: str(row.part_number),
      category: getCategory(str(row.category)),
      qty: num(row.order_qty),
      revenue,
      variableCost,
      totalCost,
      pl,
      shippedDate: str(row.shipped_date),
      status,
    })

    totalRevenue += revenue
    totalCosts += totalCost || variableCost
    totalPL += pl
  }

  const avgMargin = totalRevenue > 0 ? (totalPL / totalRevenue) * 100 : 0

  return {
    orders,
    summary: { totalRevenue, totalCosts, totalPL, avgMargin, orderCount: orders.length },
  }
}

// ─── Drawings ───

export async function fetchDrawingsFromDB(): Promise<Drawing[]> {
  const { data, error } = await supabase
    .from('production_totals')
    .select('part_number, product, mold_type, drawing_1_url, drawing_2_url')

  if (error) throw new Error(`Supabase drawings error: ${error.message}`)
  if (!data) return []

  const drawings: Drawing[] = []
  for (const row of data) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    const drawing1Url = str(row.drawing_1_url).trim()
    const drawing2Url = str(row.drawing_2_url).trim()
    if (!drawing1Url && !drawing2Url) continue

    const product = str(row.product).trim()
    const moldType = str(row.mold_type).trim()
    const productLower = product.toLowerCase()
    let productType: Drawing['productType'] = 'Other'
    if (productLower.includes('tire')) productType = 'Tire'
    else if (productLower.includes('hub')) productType = 'Hub'

    drawings.push({ partNumber, product, productType, drawing1Url, drawing2Url, moldType })
  }

  return drawings.sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}
