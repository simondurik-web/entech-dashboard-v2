/**
 * Supabase data layer — drop-in replacement for google-sheets.ts fetch functions.
 * Returns the SAME types so API routes and pages don't need changes.
 */
// Server-only data layer (imported only by app/api/* routes). Use the SERVICE-ROLE client:
// these tables have RLS enabled and grant SELECT only to service_role, so the anon client gets
// 'permission denied' and the app silently falls back to the (now-frozen) Google Sheet.
import { supabaseAdmin as supabase } from './supabase-admin'
import { calculateSalesMath, getProfitPerPart, isNoOpSalesMathRow, summarizeSalesOrders } from './sales-math'
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
  variableProfit: number
  totalProfit: number
  variableMarginPct: number
  totalMarginPct: number
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
  contributionLevel: string
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
  variableProfit: number
  totalProfit: number
  variableMarginPct: number
  totalMarginPct: number
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

// Shared dashboard_orders row → Order mapper. Used for both the live table and
// the fusion archive, which share the exact same column structure.
function mapRowToOrder(row: Record<string, unknown>): Order {
  return {
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
    shipToAddress: str(row.ship_to_address),
  }
}

// Part-intrinsic roll-tech attributes (same for every order of a given part).
type PartEnrichment = { category?: string; tire?: string; hub?: string; hubMold?: string }

// Roll-tech part numbers look like NNN.NNN.xxx (e.g. 668.254.353, 6845.201.1612);
// the middle 3-digit segment is the tire. Molding/SnapPad parts are alphabetic
// (EB-6PK-…, THRESH-…, OFLEX-…), so this only matches roll-tech.
const ROLLTECH_PN_RE = /^\d{3,4}\.(\d{3})\./

export async function fetchOrdersFromDB(): Promise<Order[]> {
  const data = await fetchAllRows('dashboard_orders')
  if (!data.length) return []

  // The ERPNext sync creates new order rows WITHOUT the roll-tech enrichment
  // (category/tire/hub/hub_mold left null), while older rows for the same part
  // still carry it. Build a part_number -> enrichment reference from the populated
  // rows so we can self-heal the null ones — otherwise Orders Data + Need to
  // Package show N/A tire/hub and can't tell a roll-tech order from a molding one.
  const ref = new Map<string, PartEnrichment>()
  for (const row of data) {
    const pn = str(row.part_number)
    if (!pn) continue
    const cur = ref.get(pn) ?? {}
    if (!cur.category && str(row.category)) cur.category = str(row.category)
    if (!cur.tire && str(row.tire)) cur.tire = str(row.tire)
    if (!cur.hub && str(row.hub)) cur.hub = str(row.hub)
    if (!cur.hubMold && str(row.hub_mold)) cur.hubMold = str(row.hub_mold)
    ref.set(pn, cur)
  }

  return data
    .map((row) => {
      const o = mapRowToOrder(row)
      // 1) Backfill from a populated sibling row of the same part (exact, part-intrinsic).
      const r = ref.get(o.partNumber)
      if (r) {
        if (!o.category && r.category) o.category = r.category
        if (!o.tire && r.tire) o.tire = r.tire
        if (!o.hub && r.hub) o.hub = r.hub
        if (!o.hubMold && r.hubMold) o.hubMold = r.hubMold
      }
      // 2) Last-resort: derive category + tire from the roll-tech part-number shape,
      //    so a brand-new roll-tech part (no populated sibling yet) still tags right.
      if (!o.category || getCategory(o.category) === 'Other') {
        const m = o.partNumber.match(ROLLTECH_PN_RE)
        if (m) {
          // Match the DB's stored casing ('Roll tech') so the category column /
          // filter dropdown don't show a mix of 'Roll tech' and 'Roll Tech'.
          if (!o.category) o.category = 'Roll tech'
          if (!o.tire) o.tire = m[1]
        }
      }
      return o
    })
    .filter((o) => o.line && o.customer)
    .filter((o) => {
      const status = normalizeStatus(o.internalStatus, o.ifStatus)
      return status !== 'cancelled'
    })
}

// Pre-ERPNext Google-Sheet order history — a full snapshot taken at the 2026-06-30
// cutover (dashboard_orders_fusion_archive, same columns as dashboard_orders).
// Read-only; surfaced in Orders Data search so old orders show alongside current
// ones. Cancelled orders are KEPT here (unlike the live feed) — the archive is the
// complete historical record. Each row is flagged archived so the UI can mark it.
export async function fetchArchivedOrders(): Promise<Order[]> {
  const data = await fetchAllRows('dashboard_orders_fusion_archive')
  if (!data.length) return []

  return data
    .map((row) => ({ ...mapRowToOrder(row), archived: true }))
    .filter((o) => o.line && o.customer)
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
  const [inventoryData, productionData, referenceData] = await Promise.all([
    fetchAllRows('inventory'),
    fetchAllRows('production_totals'),
    fetchAllRows('inventory_reference'),
  ])

  // Build Fusion map: partNumber -> qty. Minimums ride the same ERPNext-fed
  // `inventory` rows (Item.safety_stock, synced every 5 min) — the sheet-era
  // production_totals.minimums froze at the 2026-06-30 cutover and is only a
  // fallback for items that don't exist in ERPNext.
  const fusionMap = new Map<string, number>()
  const minimumMap = new Map<string, number>()
  for (const row of inventoryData) {
    const part = str(row.item_number).trim()
    if (!part) continue
    fusionMap.set(part.toUpperCase(), num(row.real_number_value))
    if (row.minimum !== null && row.minimum !== undefined && row.minimum !== '') {
      minimumMap.set(part.toUpperCase(), num(row.minimum))
    }
  }

  // Build department map from inventory_reference (department is non-sensitive;
  // it ships with the base inventory so EVERY user can filter by dept, regardless
  // of cost-view permission). Keyed by fusion_id uppercased.
  const deptMap = new Map<string, { department: string; subDepartment: string }>()
  for (const row of referenceData) {
    const fusionId = str(row.fusion_id).trim().toUpperCase()
    if (!fusionId) continue
    deptMap.set(fusionId, {
      department: str(row.department).trim(),
      subDepartment: str(row.sub_department).trim(),
    })
  }
  const lookupDept = (partNumber: string): { department: string; subDepartment: string } => {
    const key = partNumber.toUpperCase()
    return deptMap.get(key) ?? deptMap.get(key.replace(/^0+/, '')) ?? { department: '', subDepartment: '' }
  }

  const items: InventoryItem[] = []
  const seenParts = new Set<string>()

  // First pass: Production data totals (primary source)
  for (const row of productionData) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    seenParts.add(partNumber.toUpperCase())
    const product = str(row.product).trim()
    const moldType = str(row.mold_type)

    // Look up stock from Fusion
    const key = partNumber.toUpperCase()
    // ERPNext safety_stock is authoritative when the item exists there
    // (minimumMap has an entry, even a 0); sheet minimums only for legacy items.
    const minimum = minimumMap.get(key) ?? (num(row.minimums) || num(row.quantity_needed))
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

    const { department, subDepartment } = lookupDept(partNumber)
    items.push({
      partNumber, product, inStock: stock, minimum, moldType, lastUpdate: '',
      itemType, isManufactured,
      projectionRate: dailyUsage,
      usage7: null, usage30: null,
      daysToMin, daysToZero,
      department, subDepartment,
    })
  }

  // Second pass: Fusion items not in Production data totals (union merge)
  for (const row of inventoryData) {
    const partNumber = str(row.item_number).trim()
    if (!partNumber) continue
    if (seenParts.has(partNumber.toUpperCase())) continue

    const stock = num(row.real_number_value)
    const { department, subDepartment } = lookupDept(partNumber)
    items.push({
      partNumber, product: '', inStock: stock, minimum: minimumMap.get(partNumber.toUpperCase()) ?? 0, moldType: '', lastUpdate: '',
      itemType: '', isManufactured: false,
      projectionRate: null,
      usage7: null, usage30: null,
      daysToMin: null, daysToZero: null,
      department, subDepartment,
    })
  }

  return items
}

// ─── Production Make ───

export async function fetchProductionMakeFromDB(): Promise<ProductionMakeItem[]> {
  const [inventoryData, productionData, ordersData] = await Promise.all([
    fetchAllRows('inventory'),
    fetchAllRows('production_totals'),
    fetchAllRows('dashboard_orders'),
  ])

  // Live ERPNext feed (5-min sync): stock + minimums (Item.safety_stock).
  // production_totals only supplies the part list/metadata and a minimums
  // fallback for items that don't exist in ERPNext — its own quantity_needed /
  // parts_to_be_made columns froze at the 2026-06-30 sheet cutover.
  const fusionMap = new Map<string, number>()
  const minimumMap = new Map<string, number>()
  for (const row of inventoryData) {
    const part = str(row.item_number).trim()
    if (!part) continue
    fusionMap.set(part.toUpperCase(), num(row.real_number_value))
    if (row.minimum !== null && row.minimum !== undefined && row.minimum !== '') {
      minimumMap.set(part.toUpperCase(), num(row.minimum))
    }
  }

  // Open-order demand (pending/WIP, unshipped): each wheel order consumes its
  // finished part AND one tire + one hub per unit. Same demand window as the
  // tire/hub colors on Orders Data / Need to Package (component-availability).
  const demand = new Map<string, number>()
  for (const row of ordersData) {
    if (str(row.shipped_date)) continue
    const status = normalizeStatus(str(row.work_order_status), str(row.if_status_fusion))
    if (status !== 'pending' && status !== 'wip') continue
    const qty = num(row.order_qty)
    if (!qty) continue
    for (const raw of [str(row.part_number), str(row.tire), str(row.hub)]) {
      const key = raw.trim().toUpperCase()
      if (!key || key === '-') continue
      demand.set(key, (demand.get(key) ?? 0) + qty)
    }
  }

  const items: ProductionMakeItem[] = []
  for (const row of productionData) {
    const partNumber = str(row.part_number).trim()
    if (!partNumber) continue

    const key = partNumber.toUpperCase()
    const minimums = minimumMap.get(key) ?? (num(row.minimums) || num(row.quantity_needed))
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

    // Make enough to cover open orders AND land back at the minimum buffer —
    // the amount that turns the part green everywhere on the dashboard.
    const neededOpenOrders = demand.get(key) ?? 0
    const partsToBeMade = Math.max(0, Math.max(minimums, neededOpenOrders) - fusionInventory)

    if (partsToBeMade > 0 || minimums > 0 || neededOpenOrders > 0) {
      items.push({
        partNumber,
        product: str(row.product).trim(),
        moldType: str(row.mold_type),
        fusionInventory,
        minimums,
        neededOpenOrders,
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
  if (!data.length) {
    return {
      orders: [],
      summary: {
        totalRevenue: 0,
        totalCosts: 0,
        totalPL: 0,
        avgMargin: 0,
        orderCount: 0,
        shippedPL: 0,
        shippedCount: 0,
        forecastPL: 0,
        pendingCount: 0,
        variableProfit: 0,
        totalProfit: 0,
        variableMarginPct: 0,
        totalMarginPct: 0,
      },
    }
  }

  // Fetch BOM costs from DB in parallel (preferred over stale Sheets-synced values in dashboard_orders).
  // BOM has canonical per-part variable_cost, total_cost, and sales_target.
  // If multiple rows exist for the same part_number, the most-recently-updated row wins (ORDER BY updated_at DESC).
  const { data: bomData, error: bomError } = await supabase
    .from('bom_final_assemblies')
    .select('part_number, variable_cost, total_cost, sales_target')
    .order('updated_at', { ascending: false })
  if (bomError) {
    console.error('[fetchSalesFromDB] BOM query failed — falling back to dashboard_orders cost values:', bomError.message)
  }
  const bomMap = new Map<string, { variableCost: number; totalCost: number; salesTarget: number }>()
  for (const b of bomData || []) {
    // Only set first occurrence (highest updated_at wins due to ORDER BY above)
    if (!bomMap.has(b.part_number)) {
      bomMap.set(b.part_number, {
        variableCost: Number(b.variable_cost) || 0,
        totalCost: Number(b.total_cost) || 0,
        salesTarget: Number(b.sales_target) || 0,
      })
    }
  }

  const orders: SalesOrder[] = []

  for (const row of data) {
    const line = str(row.line)
    const customer = str(row.customer)
    if (!line || !customer) continue

    const status = normalizeStatus(str(row.work_order_status), str(row.if_status_fusion))
    if (status === 'cancelled') continue

    const revenue = num(row.revenue)
    const bom = bomMap.get(str(row.part_number))
    // num() already strips "$" and "," so it handles the stale Sheets-synced string format safely
    const variableCost = bom?.variableCost ?? num(row.variable_cost)
    const totalCost = bom?.totalCost ?? num(row.total_cost)
    const rawPL = num(row.pl)
    const qty = num(row.order_qty)
    const unitPrice = num(row.unit_price)
    const salesMath = calculateSalesMath({ qty, revenue, variableCost, totalCost, unitPrice })

    if (isNoOpSalesMathRow({ revenue, variableCost, totalCost })) continue
    if (revenue === 0 && rawPL === 0 && totalCost === 0 && variableCost === 0) continue

    const salesTarget = bom?.salesTarget ?? num(row.sales_target_20)
    const profitPerPart = getProfitPerPart({ qty, revenue, variableCost, totalCost, unitPrice })
    const shippingCost = num(row.shipping_cost)
    const pl = salesMath.totalProfit

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
      ...salesMath,
      shippedDate: str(row.shipped_date),
      requestedDate: str(row.requested_completion_date),
      status,
      dateOfRequest: str(row.date_of_request),
      ifNumber: str(row.if_number),
      ifStatus: str(row.if_status_fusion),
      internalStatus: str(row.work_order_status),
      poNumber: str(row.po_number),
      shippingCost, unitPrice, salesTarget, profitPerPart,
      contributionLevel: str(row.contribution_level),
    })
  }

  return {
    orders,
    summary: summarizeSalesOrders(orders),
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

// Days of history to load. The inventory page only needs ~30-day usage windows
// plus the current month's opening snapshot (≤ ~38 days back), so 120 days is a
// safe ceiling. The full table is ~200k+ rows spanning many months; limiting the
// window keeps cold loads and the client payload small. Bump if the UI ever needs
// a longer lookback.
const INVENTORY_HISTORY_DAYS = 120

export async function fetchInventoryHistoryFromDB(): Promise<InventoryHistoryData> {
  // Only fetch recent rows (date is stored as YYYY-MM-DD, which sorts lexically).
  const cutoff = new Date(Date.now() - INVENTORY_HISTORY_DAYS * 86400000)
    .toISOString()
    .slice(0, 10)

  const data: Record<string, unknown>[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data: page, error } = await supabase
      .from('inventory_history')
      .select('part_number, date, quantity')
      .gte('date', cutoff)
      // Stable ordering by the primary key is required: PostgREST does not
      // guarantee row order across .range() pages without an explicit order,
      // so without this, multi-page reads could skip or duplicate rows.
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Supabase inventory_history error: ${error.message}`)
    if (!page || page.length === 0) break
    data.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

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
