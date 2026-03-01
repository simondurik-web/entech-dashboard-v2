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
  requestedDate: string
  status: string
  dateOfRequest: string
  ifNumber: string
  ifStatus: string
  internalStatus: string
  poNumber: string
  shippingCost: number
  unitPrice: number
  salesTarget: number
  profitPerPart: number
}

export interface SalesSummary {
  totalRevenue: number
  totalCosts: number
  totalPL: number
  avgMargin: number
  orderCount: number
  shippedPL: number
  shippedCount: number
  forecastPL: number
  pendingCount: number
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
      dailyCapacity: num(row.daily_capacity),
      priorityOverride: row.priority_override ? str(row.priority_override) : null,
      priorityChangedBy: row.priority_changed_by ? str(row.priority_changed_by) : null,
      priorityChangedAt: row.priority_changed_at ? str(row.priority_changed_at) : null,
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
  const [inventoryData, productionData] = await Promise.all([
    fetchAllRows('inventory'),
    fetchAllRows('production_totals'),
  ])

  // Build Fusion map: partNumber -> qty
  const fusionMap = new Map<string, number>()
  for (const row of inventoryData) {
    const part = str(row.item_number).trim()
    if (part) fusionMap.set(part.toUpperCase(), num(row.real_number_value))
  }

  const items: InventoryItem[] = []
  const seenParts = new Set<string>()

  // First pass: Production data totals (primary source)
  for (const row of productionData) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    seenParts.add(partNumber.toUpperCase())
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

  // Second pass: Fusion items not in Production data totals (union merge)
  for (const row of inventoryData) {
    const partNumber = str(row.item_number).trim()
    if (!partNumber) continue
    if (seenParts.has(partNumber.toUpperCase())) continue

    const stock = num(row.real_number_value)
    items.push({
      partNumber, product: '', inStock: stock, minimum: 0, target: 0, moldType: '', lastUpdate: '',
      itemType: '', isManufactured: false,
      projectionRate: null,
      usage7: null, usage30: null,
      daysToMin: null, daysToZero: null,
    })
  }

  return items
}

// ─── Production Make ───

export async function fetchProductionMakeFromDB(): Promise<ProductionMakeItem[]> {
  const [inventoryData, productionData] = await Promise.all([
    fetchAllRows('inventory'),
    fetchAllRows('production_totals'),
  ])

  const fusionMap = new Map<string, number>()
  for (const row of inventoryData) {
    const part = str(row.item_number).trim()
    if (part) fusionMap.set(part.toUpperCase(), num(row.real_number_value))
  }

  const items: ProductionMakeItem[] = []
  for (const row of productionData) {
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
  if (!data.length) return { orders: [], summary: { totalRevenue: 0, totalCosts: 0, totalPL: 0, avgMargin: 0, orderCount: 0, shippedPL: 0, shippedCount: 0, forecastPL: 0, pendingCount: 0 } }

  const orders: SalesOrder[] = []
  let totalRevenue = 0
  let totalCosts = 0
  let totalPL = 0

  for (const row of data) {
    const line = str(row.line)
    const customer = str(row.customer)
    if (!line || !customer) continue

    const status = normalizeStatus(str(row.work_order_status), str(row.if_status_fusion))
    if (status === 'cancelled') continue

    const revenue = num(row.revenue)
    const variableCost = num(row.variable_cost)
    const totalCost = num(row.total_cost)
    const pl = num(row.pl)

    if (revenue === 0 && pl === 0) continue

    const qty = num(row.order_qty)
    const unitPrice = num(row.unit_price)
    const salesTarget = num(row.sales_target_20)
    const profitPerPart = num(row.profit_per_part)
    const shippingCost = num(row.shipping_cost)

    orders.push({
      line,
      customer,
      partNumber: str(row.part_number),
      category: getCategory(str(row.category)),
      qty,
      revenue,
      variableCost,
      totalCost,
      pl,
      shippedDate: str(row.shipped_date),
      requestedDate: str(row.requested_completion_date),
      status,
      dateOfRequest: str(row.date_of_request),
      ifNumber: str(row.if_number),
      ifStatus: str(row.if_status_fusion),
      internalStatus: str(row.work_order_status),
      poNumber: str(row.po_number),
      shippingCost, unitPrice, salesTarget, profitPerPart,
    })

    totalRevenue += revenue
    totalCosts += totalCost || variableCost
    totalPL += pl
  }

  const shippedOrders = orders.filter(o => o.status === 'shipped')
  const shippedPL = shippedOrders.reduce((s, o) => s + o.pl, 0)
  const shippedCount = shippedOrders.length
  const forecastPL = totalPL - shippedPL
  const pendingCount = orders.length - shippedCount
  const avgMargin = totalRevenue > 0 ? (totalPL / totalRevenue) * 100 : 0

  return {
    orders,
    summary: { totalRevenue, totalCosts, totalPL, avgMargin, orderCount: orders.length, shippedPL, shippedCount, forecastPL, pendingCount },
  }
}

// ─── Drawings ───

export async function fetchDrawingsFromDB(): Promise<Drawing[]> {
  const data = await fetchAllRows('production_totals')

  const drawings: Drawing[] = []
  for (const row of data) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    const drawingUrls: string[] = []
    for (const key of Object.keys(row)) {
      if (key.match(/^drawing_\d+_url$/) && str(row[key]).trim()) {
        drawingUrls.push(str(row[key]).trim())
      }
    }
    if (drawingUrls.length === 0) continue

    const product = str(row.product).trim()
    const moldType = str(row.mold_type).trim()
    const productLower = product.toLowerCase()
    let productType: Drawing['productType'] = 'Other'
    if (productLower.includes('tire')) productType = 'Tire'
    else if (productLower.includes('hub')) productType = 'Hub'

    drawings.push({ partNumber, product, productType, drawingUrls, moldType })
  }

  return drawings.sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

// ─── Inventory Reference (costs/departments from Supabase) ───

export interface InventoryCostEntry {
  fusionId: string
  description: string
  netsuiteId: string
  cost: number | null
  lowerCost: number | null
  department: string
  subDepartment: string
}

export async function fetchInventoryCostsFromDB(): Promise<Record<string, InventoryCostEntry>> {
  const data = await fetchAllRows('inventory_reference')
  const costs: Record<string, InventoryCostEntry> = {}

  for (const row of data) {
    const fusionId = str(row.fusion_id).trim()
    if (!fusionId) continue

    costs[fusionId] = {
      fusionId,
      description: str(row.description).trim(),
      netsuiteId: str(row.netsuite_id).trim(),
      cost: row.cost != null ? Number(row.cost) : null,
      lowerCost: row.lower_cost != null ? Number(row.lower_cost) : null,
      department: str(row.department).trim(),
      subDepartment: str(row.sub_department).trim(),
    }
  }

  return costs
}

// ─── Inventory History (from Supabase) ───

import type { InventoryHistoryData, InventoryHistoryPart } from './google-sheets-shared'

export async function fetchInventoryHistoryFromDB(): Promise<InventoryHistoryData> {
  const data = await fetchAllRows('inventory_history')

  // Group by part number, collect dates
  const partMap = new Map<string, Record<string, number>>()
  const dateSet = new Set<string>()

  for (const row of data) {
    const partNumber = str(row.part_number).trim()
    const date = str(row.date).trim()
    const quantity = Number(row.quantity) || 0

    if (!partNumber || !date) continue

    // Convert YYYY-MM-DD to MM/DD/YYYY for compatibility with existing frontend
    const [y, m, d] = date.split('-')
    const displayDate = `${parseInt(m)}/${parseInt(d)}/${y}`

    dateSet.add(displayDate)

    if (!partMap.has(partNumber)) partMap.set(partNumber, {})
    partMap.get(partNumber)![displayDate] = quantity
  }

  // Sort dates chronologically
  const dates = Array.from(dateSet).sort((a, b) => {
    const [am, ad, ay] = a.split('/').map(Number)
    const [bm, bd, by] = b.split('/').map(Number)
    return new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime()
  })

  const parts: InventoryHistoryPart[] = []
  for (const [partNumber, dataByDate] of partMap) {
    parts.push({ partNumber, dataByDate })
  }

  return { dates, parts }
}
