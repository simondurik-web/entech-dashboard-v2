const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'

export const GIDS = {
  orders: '290032634',
  inventory: '1805754553',
  productionTotals: '148810546',
  palletPictures: '1879462508',
  stagedRecords: '1519623398',
  shippingRecords: '1752263458',
} as const

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
  requestedDate: string
  daysUntilDue: number | null
  assignedTo: string
  shippedDate: string
}

// Column indices: A=0..Z=25, AA=26..AV=47
const COLS = {
  line: 0,
  category: 1,
  dateOfRequest: 2,
  priorityLevel: 3,
  urgentOverride: 4,
  ifNumber: 5,
  ifStatus: 6,
  internalStatus: 7,
  poNumber: 8,
  customer: 9,
  partNumber: 11,
  orderQty: 15,
  packaging: 16,
  requestedDate: 22,
  daysUntilDue: 23,
  shippedDate: 45,
  assignedTo: 47,
}

function cellValue(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const cell = row.c[col]
  if (!cell || cell.v === null || cell.v === undefined) return ''
  return String(cell.v)
}

// Google Sheets returns dates as "Date(2023,4,22)" (month is 0-indexed)
function cellDate(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const raw = cellValue(row, col)
  const match = raw.match(/^Date\((\d+),(\d+),(\d+)\)$/)
  if (!match) return raw
  const [, y, m, d] = match
  return `${Number(m) + 1}/${d}/${y}`
}

function cellNumber(row: { c: Array<{ v: unknown } | null> }, col: number): number {
  const cell = row.c[col]
  if (!cell || cell.v === null || cell.v === undefined) return 0
  return Number(cell.v) || 0
}

export function parseOrder(row: { c: Array<{ v: unknown } | null> }): Order {
  return {
    line: cellValue(row, COLS.line),
    category: cellValue(row, COLS.category),
    dateOfRequest: cellDate(row, COLS.dateOfRequest),
    priorityLevel: cellNumber(row, COLS.priorityLevel),
    urgentOverride: cellValue(row, COLS.urgentOverride).toLowerCase() === 'true',
    ifNumber: cellValue(row, COLS.ifNumber),
    ifStatus: cellValue(row, COLS.ifStatus),
    internalStatus: cellValue(row, COLS.internalStatus),
    poNumber: cellValue(row, COLS.poNumber),
    customer: cellValue(row, COLS.customer),
    partNumber: cellValue(row, COLS.partNumber),
    orderQty: cellNumber(row, COLS.orderQty),
    packaging: cellValue(row, COLS.packaging),
    requestedDate: cellDate(row, COLS.requestedDate),
    daysUntilDue: cellNumber(row, COLS.daysUntilDue) || null,
    shippedDate: cellDate(row, COLS.shippedDate),
    assignedTo: cellValue(row, COLS.assignedTo),
  }
}

export async function fetchSheetData(gid: string): Promise<{ cols: string[]; rows: Array<{ c: Array<{ v: unknown } | null> }> }> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  const text = await res.text()

  // Google wraps JSON in: /*O_o*/ google.visualization.Query.setResponse({...});
  const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
  const data = JSON.parse(jsonStr)

  const cols: string[] = data.table.cols.map((c: { label: string }) => c.label)
  const rows = data.table.rows as Array<{ c: Array<{ v: unknown } | null> }>

  return { cols, rows }
}

export async function fetchOrders(): Promise<Order[]> {
  const { rows } = await fetchSheetData(GIDS.orders)
  return rows.map(parseOrder).filter((o) => o.line && o.customer)
}

// --- Inventory ---

export interface InventoryItem {
  partNumber: string
  product: string
  inStock: number
  minimum: number
  target: number
  moldType: string
  lastUpdate: string
}

// Fusion Export columns (GID 1805754553) — row 0 is header
// A=partNumber, B=qty
const FUSION_COLS = { partNumber: 0, qty: 1 }

// Production Data Totals columns (GID 148810546)
// A=Product, B=Part Number, C=Quantity Needed, D=Minimums, E=Manual target, F=Mold type
const PROD_COLS = {
  product: 0,
  partNumber: 1,
  quantityNeeded: 2,
  minimums: 3,
  manualTarget: 4,
  moldType: 5,
}

export async function fetchInventory(): Promise<InventoryItem[]> {
  const [fusion, production] = await Promise.all([
    fetchSheetData(GIDS.inventory),
    fetchSheetData(GIDS.productionTotals),
  ])

  // Build Fusion Export map: partNumber -> qty
  const fusionMap = new Map<string, number>()
  for (let i = 1; i < fusion.rows.length; i++) {
    const row = fusion.rows[i]
    const part = cellValue(row, FUSION_COLS.partNumber).trim()
    const qty = cellNumber(row, FUSION_COLS.qty)
    if (part) fusionMap.set(part.toUpperCase(), qty)
  }

  // Parse Production Data Totals and look up stock from Fusion Export
  const items: InventoryItem[] = []
  for (const row of production.rows) {
    const partNumber = cellValue(row, PROD_COLS.partNumber).trim()
    if (!partNumber) continue

    const product = cellValue(row, PROD_COLS.product).trim()
    const minimum = cellNumber(row, PROD_COLS.quantityNeeded) || cellNumber(row, PROD_COLS.minimums)
    const target = cellNumber(row, PROD_COLS.manualTarget)
    const moldType = cellValue(row, PROD_COLS.moldType)

    // Look up stock from Fusion: exact match, then startsWith
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

    items.push({ partNumber, product, inStock: inStock ?? 0, minimum, target, moldType, lastUpdate: '' })
  }

  return items
}

// --- Production Make (parts to manufacture) ---

export interface ProductionMakeItem {
  partNumber: string
  product: string
  moldType: string
  fusionInventory: number
  minimums: number
  partsToBeMade: number
  drawingUrl: string
}

export async function fetchProductionMake(): Promise<ProductionMakeItem[]> {
  const [fusion, production] = await Promise.all([
    fetchSheetData(GIDS.inventory),
    fetchSheetData(GIDS.productionTotals),
  ])

  // Build Fusion Export map: partNumber -> qty
  const fusionMap = new Map<string, number>()
  for (let i = 1; i < fusion.rows.length; i++) {
    const row = fusion.rows[i]
    const part = cellValue(row, FUSION_COLS.partNumber).trim()
    const qty = cellNumber(row, FUSION_COLS.qty)
    if (part) fusionMap.set(part.toUpperCase(), qty)
  }

  // Parse Production Data Totals
  const items: ProductionMakeItem[] = []
  for (const row of production.rows) {
    const partNumber = cellValue(row, PROD_COLS.partNumber).trim()
    if (!partNumber) continue

    const product = cellValue(row, PROD_COLS.product).trim()
    const minimums = cellNumber(row, PROD_COLS.minimums) || cellNumber(row, PROD_COLS.quantityNeeded)
    const moldType = cellValue(row, PROD_COLS.moldType)

    // Look up stock from Fusion
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

    // Calculate parts to be made
    const partsToBeMade = Math.max(0, minimums - fusionInventory)

    // Only include items that need to be made
    if (partsToBeMade > 0 || minimums > 0) {
      items.push({
        partNumber,
        product,
        moldType,
        fusionInventory,
        minimums,
        partsToBeMade,
        drawingUrl: '', // Will come from Drawings tab when connected
      })
    }
  }

  // Sort by parts to be made (descending)
  return items.sort((a, b) => b.partsToBeMade - a.partsToBeMade)
}

// --- Pallet Records ---

export interface PalletRecord {
  timestamp: string
  orderNumber: string
  palletNumber: string
  customer: string
  ifNumber: string
  category: string
  weight: string
  dimensions: string
  partsPerPallet: string
  photos: string[]
}

function findColumnValue(
  row: { c: Array<{ v: unknown } | null> },
  cols: string[],
  columnLabels: string[]
): string {
  // Find column index by matching label
  for (let i = 0; i < cols.length; i++) {
    const label = cols[i].toLowerCase()
    for (const target of columnLabels) {
      if (label.includes(target.toLowerCase())) {
        return cellValue(row, i)
      }
    }
  }
  return ''
}

export async function fetchPalletRecords(): Promise<PalletRecord[]> {
  const { cols, rows } = await fetchSheetData(GIDS.palletPictures)
  
  const records: PalletRecord[] = []
  
  for (const row of rows) {
    const timestamp = findColumnValue(row, cols, ['timestamp', 'marca de tiempo'])
    const orderNumber = findColumnValue(row, cols, ['order number', 'numero de orden'])
    const ifNumber = findColumnValue(row, cols, ['if number', 'numero if'])
    
    // Skip empty rows
    if (!timestamp && !orderNumber && !ifNumber) continue
    
    const photos: string[] = []
    for (let i = 1; i <= 5; i++) {
      const photoUrl = findColumnValue(row, cols, [`pallet picture${i === 1 ? '' : ' ' + i}`, `fotos de paletas${i === 1 ? '' : ' ' + i}`])
      if (photoUrl) photos.push(photoUrl)
    }
    
    records.push({
      timestamp,
      orderNumber,
      palletNumber: findColumnValue(row, cols, ['pallet number', 'numero de paleta']),
      customer: findColumnValue(row, cols, ['customer', 'cliente']),
      ifNumber,
      category: findColumnValue(row, cols, ['category', 'categoria']),
      weight: findColumnValue(row, cols, ['pallet weight', 'peso de la paleta']),
      dimensions: findColumnValue(row, cols, ['pallet dimensions', 'dimensiones de la paleta']),
      partsPerPallet: findColumnValue(row, cols, ['parts/boxes per pallet', 'partes o cajas por paleta']),
      photos,
    })
  }
  
  // Sort by timestamp descending
  return records.sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime() || 0
    const dateB = new Date(b.timestamp).getTime() || 0
    return dateB - dateA
  })
}

// --- Shipping Records ---

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
}

export async function fetchShippingRecords(): Promise<ShippingRecord[]> {
  const { cols, rows } = await fetchSheetData(GIDS.shippingRecords)
  
  const records: ShippingRecord[] = []
  
  for (const row of rows) {
    const timestamp = findColumnValue(row, cols, ['timestamp', 'marca de tiempo'])
    const shipDate = findColumnValue(row, cols, ['ship date', 'fecha de envio'])
    const ifNumber = findColumnValue(row, cols, ['if number', 'numero if'])
    
    if (!timestamp && !shipDate && !ifNumber) continue
    
    const photos: string[] = []
    for (let i = 1; i <= 5; i++) {
      const photoUrl = findColumnValue(row, cols, [`photo${i === 1 ? '' : ' ' + i}`, `foto${i === 1 ? '' : ' ' + i}`])
      if (photoUrl) photos.push(photoUrl)
    }
    
    records.push({
      timestamp,
      shipDate,
      customer: findColumnValue(row, cols, ['customer', 'cliente']),
      ifNumber,
      category: findColumnValue(row, cols, ['category', 'categoria']),
      carrier: findColumnValue(row, cols, ['carrier', 'transportista']),
      bol: findColumnValue(row, cols, ['bol', 'bill of lading']),
      palletCount: parseInt(findColumnValue(row, cols, ['pallet count', 'cantidad de paletas'])) || 0,
      photos,
    })
  }
  
  return records.sort((a, b) => {
    const dateA = new Date(a.timestamp || a.shipDate).getTime() || 0
    const dateB = new Date(b.timestamp || b.shipDate).getTime() || 0
    return dateB - dateA
  })
}

// --- Staged Records ---

export interface StagedRecord {
  timestamp: string
  ifNumber: string
  customer: string
  partNumber: string
  category: string
  quantity: number
  location: string
  photos: string[]
}

export async function fetchStagedRecords(): Promise<StagedRecord[]> {
  const { cols, rows } = await fetchSheetData(GIDS.stagedRecords)
  
  const records: StagedRecord[] = []
  
  for (const row of rows) {
    const timestamp = findColumnValue(row, cols, ['timestamp', 'marca de tiempo'])
    const ifNumber = findColumnValue(row, cols, ['if number', 'numero if'])
    
    if (!timestamp && !ifNumber) continue
    
    const photos: string[] = []
    for (let i = 1; i <= 3; i++) {
      const photoUrl = findColumnValue(row, cols, [`photo${i === 1 ? '' : ' ' + i}`, `foto${i === 1 ? '' : ' ' + i}`])
      if (photoUrl) photos.push(photoUrl)
    }
    
    records.push({
      timestamp,
      ifNumber,
      customer: findColumnValue(row, cols, ['customer', 'cliente']),
      partNumber: findColumnValue(row, cols, ['part number', 'numero de parte']),
      category: findColumnValue(row, cols, ['category', 'categoria']),
      quantity: parseInt(findColumnValue(row, cols, ['quantity', 'cantidad'])) || 0,
      location: findColumnValue(row, cols, ['location', 'ubicacion']),
      photos,
    })
  }
  
  return records.sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime() || 0
    const dateB = new Date(b.timestamp).getTime() || 0
    return dateB - dateA
  })
}
