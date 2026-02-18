const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'

export const GIDS = {
  orders: '290032634',
  inventory: '1805754553',
  inventoryHistory: '171540940',
  productionTotals: '148810546',
  palletPictures: '1879462508',
  stagedRecords: '1519623398',
  shippingRecords: '1752263458',
  bomFinal: '74377031',
  bomSub: '206288913',
  bomIndividual: '751106736',
  fpReference: '944406361',
  customerReference: '336333220',
  quotesRegistry: '1279128282',
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
}

// Column indices: A=0..Z=25, AA=26..AV=47
// Verified from Google Sheets Main Data columns (2026-02-07)
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
  fusionInventory: 13, // Column N: "Fusion inventory"
  orderQty: 15,
  packaging: 16,
  partsPerPackage: 17, // Column R: "Parts per package"
  numPackages: 18,     // Column S: "Number of packages"
  requestedDate: 22,
  daysUntilDue: 23,
  tire: 26,        // Column AA: "Tire" (part number like "308")
  hasTire: 27,     // Column AB: "Have Tire?" (boolean)
  hub: 30,         // Column AE: "Hub" (part number like "H19.170.22100B")
  hasHub: 31,      // Column AF: "Have Hub?" (boolean)
  hubMold: 35,     // Column AJ: "Hub Mold"
  bearings: 36,    // Column AK: "Bearings"
  shippedDate: 45, // Column AT: "Shipped Date"
  assignedTo: 47,  // Column AV: "Assigned to:"
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

// Normalize internal status to standard categories
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

export function parseOrder(row: { c: Array<{ v: unknown } | null> }): Order {
  const internalStatus = cellValue(row, COLS.internalStatus)
  const ifStatus = cellValue(row, COLS.ifStatus)
  
  return {
    line: cellValue(row, COLS.line),
    category: cellValue(row, COLS.category),
    dateOfRequest: cellDate(row, COLS.dateOfRequest),
    priorityLevel: cellNumber(row, COLS.priorityLevel),
    urgentOverride: cellValue(row, COLS.urgentOverride).toLowerCase() === 'true',
    ifNumber: cellValue(row, COLS.ifNumber),
    ifStatus: ifStatus,
    internalStatus: internalStatus,
    poNumber: cellValue(row, COLS.poNumber),
    customer: cellValue(row, COLS.customer),
    partNumber: cellValue(row, COLS.partNumber),
    orderQty: cellNumber(row, COLS.orderQty),
    packaging: cellValue(row, COLS.packaging),
    partsPerPackage: cellNumber(row, COLS.partsPerPackage),
    numPackages: cellNumber(row, COLS.numPackages),
    fusionInventory: cellNumber(row, COLS.fusionInventory),
    hubMold: cellValue(row, COLS.hubMold),
    tire: cellValue(row, COLS.tire),
    hasTire: ['true', '1', 'yes'].includes(cellValue(row, COLS.hasTire).toLowerCase()),
    hub: cellValue(row, COLS.hub),
    hasHub: ['true', '1', 'yes'].includes(cellValue(row, COLS.hasHub).toLowerCase()),
    bearings: cellValue(row, COLS.bearings),
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
  // Use CSV export instead of gviz — gviz silently truncates columns beyond Z (26)
  // CSV returns ALL columns reliably
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GIDS.orders}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  const csvText = await res.text()
  const rows = parseCSVRows(csvText)
  
  if (rows.length < 2) return []
  
  const headers = rows[0]
  const dataRows = rows.slice(1)
  
  // Build header index map for reliable column lookup
  const headerIndex = new Map<string, number>()
  headers.forEach((h, i) => headerIndex.set(h.trim(), i))
  
  function col(row: string[], index: number): string {
    return (index >= 0 && index < row.length) ? row[index].trim() : ''
  }
  
  function colNum(row: string[], index: number): number {
    const v = col(row, index)
    return Number(v.replace(/[,$]/g, '')) || 0
  }
  
  function colDate(row: string[], index: number): string {
    return col(row, index)
  }
  
  return dataRows
    .map((row): Order => {
      const internalStatus = col(row, COLS.internalStatus)
      const ifStatus = col(row, COLS.ifStatus)
      const haveTireVal = col(row, COLS.hasTire).toLowerCase()
      const haveHubVal = col(row, COLS.hasHub).toLowerCase()
      
      return {
        line: col(row, COLS.line),
        category: col(row, COLS.category),
        dateOfRequest: colDate(row, COLS.dateOfRequest),
        priorityLevel: colNum(row, COLS.priorityLevel),
        urgentOverride: col(row, COLS.urgentOverride).toLowerCase() === 'true',
        ifNumber: col(row, COLS.ifNumber),
        ifStatus,
        internalStatus,
        poNumber: col(row, COLS.poNumber),
        customer: col(row, COLS.customer),
        partNumber: col(row, COLS.partNumber),
        orderQty: colNum(row, COLS.orderQty),
        packaging: col(row, COLS.packaging),
        partsPerPackage: colNum(row, COLS.partsPerPackage),
        numPackages: colNum(row, COLS.numPackages),
        fusionInventory: colNum(row, COLS.fusionInventory),
        hubMold: col(row, COLS.hubMold),
        tire: col(row, COLS.tire),
        hasTire: ['true', '1', 'yes'].includes(haveTireVal),
        hub: col(row, COLS.hub),
        hasHub: ['true', '1', 'yes'].includes(haveHubVal),
        bearings: col(row, COLS.bearings),
        requestedDate: colDate(row, COLS.requestedDate),
        daysUntilDue: colNum(row, COLS.daysUntilDue) || null,
        shippedDate: colDate(row, COLS.shippedDate),
        assignedTo: col(row, COLS.assignedTo),
      }
    })
    .filter((o) => o.line && o.customer)
    // Filter out cancelled orders by default
    .filter((o) => {
      const status = normalizeStatus(o.internalStatus, o.ifStatus)
      return status !== 'cancelled'
    })
}

export interface InventoryHistoryPart {
  partNumber: string
  dataByDate: Record<string, number>
}

export interface InventoryHistoryData {
  dates: string[]
  parts: InventoryHistoryPart[]
}

function parseSheetNumber(value: string): number {
  if (!value || value === '') return 0
  let clean = value.replace(/[$,%\s]/g, '')
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = `-${clean.slice(1, -1)}`
  }
  return Number.parseFloat(clean) || 0
}

function parseCSVRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    const next = csv[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

export async function fetchInventoryHistory(): Promise<InventoryHistoryData> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GIDS.inventoryHistory}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  const csvText = await res.text()

  const rows = parseCSVRows(csvText).filter((row) =>
    row.some((cell) => cell.trim() !== '')
  )
  if (rows.length === 0) return { dates: [], parts: [] }

  const header = rows[0]
  const dateColumns: Array<{ index: number; date: string }> = []

  for (let i = 1; i < header.length; i++) {
    const date = (header[i] || '').trim()
    if (date && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
      dateColumns.push({ index: i, date })
    }
  }

  const parts: InventoryHistoryPart[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const partNumber = (row[0] || '').trim()
    if (!partNumber) continue

    const dataByDate: Record<string, number> = {}
    for (const dateColumn of dateColumns) {
      dataByDate[dateColumn.date] = parseSheetNumber(row[dateColumn.index] || '')
    }

    parts.push({ partNumber, dataByDate })
  }

  return {
    dates: dateColumns.map((d) => d.date),
    parts,
  }
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
  itemType: string          // "Manufactured" | "Purchased" | "COM" | ""
  isManufactured: boolean
  projectionRate: number | null  // avg daily usage/production rate
  usage7: number | null     // 7-day usage
  usage30: number | null    // 30-day usage
  daysToMin: number | null  // days until stock hits minimum
  daysToZero: number | null // days until stock hits zero
}

// Fusion Export columns (GID 1805754553) — row 0 is header
// A=partNumber, B=qty
const FUSION_COLS = { partNumber: 0, qty: 1 }

// Production Data Totals columns (GID 148810546)
// A=Product, B=Part Number, C=Qty Needed, D=Minimums, E=Manual target, F=Mold type, G=Fusion inv, H=Parts to make, I=Last update, J=Time, K=Active, L=Drawing1 URL, M=Drawing2 URL
const PROD_COLS = {
  product: 0,
  partNumber: 1,
  quantityNeeded: 2,
  minimums: 3,
  manualTarget: 4,
  moldType: 5,
  fusionInventory: 6,
  partsToMake: 7,
  lastUpdate: 8,
  time: 9,
  productActive: 10,
  drawing1Url: 11,  // Column L - Drawing 1 URL
  drawing2Url: 12,  // Column M - Drawing 2 URL
  makePurchasedCom: 13, // Column N - Make/Purchased/Com
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
    const minimum = cellNumber(row, PROD_COLS.minimums) || cellNumber(row, PROD_COLS.quantityNeeded)
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

    // Parse Make/Purchased/Com
    const makePurchasedRaw = cellValue(row, PROD_COLS.makePurchasedCom).toLowerCase().trim()
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
    // Simple projection: estimate days to min/zero based on minimum as reference
    const dailyUsage = minimum > 0 ? minimum / 30 : null // rough estimate
    const daysToMin = dailyUsage && dailyUsage > 0 && stock > minimum ? Math.round((stock - minimum) / dailyUsage) : (stock <= minimum && minimum > 0 ? 0 : null)
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
      lineNumber: findColumnValue(row, cols, ['line number', 'numero de linea', 'line #', 'line']),
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
  shipmentPhotos: string[]
  paperworkPhotos: string[]
  closeUpPhotos: string[]
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

    // Parse category-specific photo columns (V1: Shipment Pictures, Paperwork Pictures, Close Up Pictures)
    const shipmentPhotos: string[] = []
    const paperworkPhotos: string[] = []
    const closeUpPhotos: string[] = []
    const shipmentRaw = findColumnValue(row, cols, ['shipment pictures', 'fotos de envio'])
    if (shipmentRaw) shipmentPhotos.push(shipmentRaw)
    const paperworkRaw = findColumnValue(row, cols, ['paperwork pictures', 'fotos de documentos'])
    if (paperworkRaw) paperworkPhotos.push(paperworkRaw)
    const closeUpRaw = findColumnValue(row, cols, ['close up pictures', 'fotos de cerca'])
    if (closeUpRaw) closeUpPhotos.push(closeUpRaw)
    
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
      shipmentPhotos,
      paperworkPhotos,
      closeUpPhotos,
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
  fusionPhotos: string[]
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
    
    // Parse fusion photos — scan ALL columns for fusion picture URLs
    const fusionPhotos: string[] = []
    for (let ci = 0; ci < cols.length; ci++) {
      const colName = cols[ci].toLowerCase()
      // Match "Fusion Picture*" or "Foto de Fusion*" but NOT "Staged in Fusion"
      if ((colName.includes('fusion picture') || colName.includes('foto de fusion') || colName === 'fusion') && !colName.includes('staged')) {
        const val = cellValue(row, ci)
        if (val && val.includes('http')) {
          const urls = val.split(/[\s,]+/).filter((s: string) => s.startsWith('http'))
          fusionPhotos.push(...urls)
        }
      }
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
      fusionPhotos,
    })
  }
  
  return records.sort((a, b) => {
    const dateA = new Date(a.timestamp).getTime() || 0
    const dateB = new Date(b.timestamp).getTime() || 0
    return dateB - dateA
  })
}

// --- Drawings ---

export interface Drawing {
  partNumber: string
  product: string
  productType: 'Tire' | 'Hub' | 'Other'
  drawing1Url: string
  drawing2Url: string
  moldType: string
}

export async function fetchDrawings(): Promise<Drawing[]> {
  const { rows } = await fetchSheetData(GIDS.productionTotals)
  
  const drawings: Drawing[] = []
  
  for (const row of rows) {
    const partNumber = cellValue(row, PROD_COLS.partNumber).trim()
    if (!partNumber) continue
    
    const drawing1Url = cellValue(row, PROD_COLS.drawing1Url).trim()
    const drawing2Url = cellValue(row, PROD_COLS.drawing2Url).trim()
    
    // Only include parts that have at least one drawing URL
    if (!drawing1Url && !drawing2Url) continue
    
    const product = cellValue(row, PROD_COLS.product).trim()
    const moldType = cellValue(row, PROD_COLS.moldType).trim()
    const productLower = product.toLowerCase()
    
    let productType: Drawing['productType'] = 'Other'
    if (productLower.includes('tire')) productType = 'Tire'
    else if (productLower.includes('hub')) productType = 'Hub'
    
    drawings.push({
      partNumber,
      product,
      productType,
      drawing1Url,
      drawing2Url,
      moldType,
    })
  }
  
  return drawings.sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

// --- BOM (Bill of Materials) ---

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

function parseCurrency(val: unknown): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return val
  const s = String(val).replace(/[$,\s]/g, '')
  return parseFloat(s) || 0
}

function parseComponentGroup(
  row: { c: Array<{ v: unknown } | null> },
  startCol: number,
  cat: BOMComponent['category'],
  descriptionHint?: string
): BOMComponent | null {
  const pn = cellValue(row, startCol)
  if (!pn) return null
  const qty = cellNumber(row, startCol + 1)
  const extendedCost = parseCurrency(row.c[startCol + 2]?.v)
  // Sheet stores: [part, qty_per_unit, extended_cost_per_unit]
  // extended_cost = qty × unit_price (already multiplied)
  // So costPerUnit = extendedCost / qty to allow qty × costPerUnit = extendedCost
  const costPerUnit = qty > 0 ? extendedCost / qty : extendedCost
  return {
    partNumber: pn,
    description: descriptionHint || pn,
    quantity: qty || 1,
    unit: 'ea',
    costPerUnit,
    category: cat,
  }
}

export async function fetchBOM(gid: string = GIDS.bomFinal): Promise<BOMItem[]> {
  const { rows } = await fetchSheetData(gid)

  const items: BOMItem[] = []

  for (const row of rows) {
    const partNumber = cellValue(row, 0)
    if (!partNumber) continue

    const category = cellValue(row, 1) || 'Other'
    const product = cellValue(row, 4) || category
    const qtyPerPallet = cellNumber(row, 5)

    const components: BOMComponent[] = []

    // Cols 6-8: Tire / main material (raw)
    const tire = parseComponentGroup(row, 6, 'raw', 'Tire')
    if (tire) components.push(tire)

    // Cols 9-11: Hub (raw)
    const hub = parseComponentGroup(row, 9, 'raw', 'Hub')
    if (hub) components.push(hub)

    // Cols 12-23: Components (bearings, plugs, springs, etc.) in groups of 3
    for (let col = 12; col <= 21; col += 3) {
      const comp = parseComponentGroup(row, col, 'component')
      if (comp) components.push(comp)
    }

    // Cols 24-41: Packaging in groups of 3
    for (let col = 24; col <= 39; col += 3) {
      const pkg = parseComponentGroup(row, col, 'packaging')
      if (pkg) components.push(pkg)
    }

    // Cols 42-48: Energy & Labor
    const kwhMultiplier = cellNumber(row, 43)
    const kwhRate = parseCurrency(row.c[44]?.v)
    if (kwhMultiplier && kwhRate) {
      components.push({
        partNumber: 'KWH',
        description: 'Energy (KWH)',
        quantity: kwhMultiplier,
        unit: 'kwh',
        costPerUnit: kwhRate,
        category: 'energy',
      })
    }

    const laborCost = parseCurrency(row.c[48]?.v)
    if (laborCost) {
      components.push({
        partNumber: 'LABOR',
        description: 'Direct Labor',
        quantity: 1,
        unit: 'ea',
        costPerUnit: laborCost,
        category: 'energy',
      })
    }

    const materialCost = components
      .filter(c => c.category === 'raw')
      .reduce((s, c) => s + c.quantity * c.costPerUnit, 0)
    const packagingCost = components
      .filter(c => c.category === 'packaging')
      .reduce((s, c) => s + c.quantity * c.costPerUnit, 0)
    const laborEnergyCost = components
      .filter(c => c.category === 'energy')
      .reduce((s, c) => s + c.quantity * c.costPerUnit, 0)
    const totalCost = components.reduce((s, c) => s + c.quantity * c.costPerUnit, 0)

    items.push({
      partNumber,
      product,
      category,
      qtyPerPallet,
      components,
      totalCost,
      materialCost,
      packagingCost,
      laborEnergyCost,
    })
  }

  return items.sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

/**
 * Sub Assembly BOM (GID 206288913)
 * Cols: A=Part, B=Category, C=Mold, D=Weight, E-G=Comp1(name/qty/cost),
 * H-J=Comp2, K-M=Comp3, N-P=Comp4, Q-S=Comp5, T=MaterialCost,
 * U=Parts/hr, V=Labor$/hr, W=Employees, X=Labor$/part, Z=TotalCost
 */
export async function fetchBOMSub(): Promise<BOMItem[]> {
  const { rows } = await fetchSheetData(GIDS.bomSub)
  const items: BOMItem[] = []

  for (const row of rows) {
    const partNumber = cellValue(row, 0)
    if (!partNumber) continue

    const category = cellValue(row, 1) || 'Other'
    const weight = cellNumber(row, 3)
    const components: BOMComponent[] = []

    // 5 component groups: cols 4-6, 7-9, 10-12, 13-15, 16-18
    for (let i = 0; i < 5; i++) {
      const base = 4 + i * 3
      const pn = cellValue(row, base)
      if (!pn) continue
      const qty = cellNumber(row, base + 1) || 1
      const cost = parseCurrency(row.c[base + 2]?.v)
      components.push({
        partNumber: pn,
        description: pn,
        quantity: qty,
        unit: 'ea',
        costPerUnit: qty > 0 ? cost / qty : cost,
        category: 'raw',
      })
    }

    // Labor: cols 20=parts/hr, 21=labor$/hr, 22=employees, 23=labor$/part
    const laborPerPart = parseCurrency(row.c[23]?.v)
    if (laborPerPart > 0) {
      components.push({
        partNumber: 'LABOR',
        description: 'Direct Labor',
        quantity: 1,
        unit: 'ea',
        costPerUnit: laborPerPart,
        category: 'energy',
      })
    }

    const materialCost = parseCurrency(row.c[19]?.v)
    const totalCost = parseCurrency(row.c[25]?.v) || (materialCost + laborPerPart)

    items.push({
      partNumber,
      product: `${category}${weight ? ` · ${weight} lbs` : ''}`,
      category,
      qtyPerPallet: 0,
      components,
      totalCost,
      materialCost,
      packagingCost: 0,
      laborEnergyCost: laborPerPart,
    })
  }

  return items.sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

/**
 * Individual Items BOM (GID 751106736)
 * Cols: A=Part Name, B=Description, C=Cost per pound/part, D=Supplier
 */
export async function fetchBOMIndividual(): Promise<BOMItem[]> {
  const { rows } = await fetchSheetData(GIDS.bomIndividual)
  const items: BOMItem[] = []

  for (const row of rows) {
    const partNumber = cellValue(row, 0)
    if (!partNumber) continue

    const description = cellValue(row, 1) || partNumber
    const costPerUnit = parseCurrency(row.c[2]?.v)
    const supplier = cellValue(row, 3)

    items.push({
      partNumber,
      product: description,
      category: supplier || 'Unknown',
      qtyPerPallet: 0,
      components: [{
        partNumber,
        description,
        quantity: 1,
        unit: 'ea',
        costPerUnit,
        category: 'raw',
      }],
      totalCost: costPerUnit,
      materialCost: costPerUnit,
      packagingCost: 0,
      laborEnergyCost: 0,
    })
  }

  return items.sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}
