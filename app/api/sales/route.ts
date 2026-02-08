import { NextResponse } from 'next/server'

const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
const MAIN_DATA_GID = '290032634'

// Column indices for Main Data sheet (0-indexed)
// A=0 Line, B=1 Category, ..., J=9 Customer, L=11 Part#, P=15 OrderQty, 
// Revenue, Variable Cost, Total Cost, P/L are in later columns
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
  requestedDate: 22,
  shippedDate: 45,
  // Financial columns (need to verify exact positions)
  revenue: 36,        // Column AK
  variableCost: 37,   // Column AL
  totalCost: 38,      // Column AM
  pl: 39,             // Column AN
}

function cellValue(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const cell = row.c?.[col]
  if (!cell || cell.v === null || cell.v === undefined) return ''
  return String(cell.v)
}

function cellNumber(row: { c: Array<{ v: unknown } | null> }, col: number): number {
  const raw = cellValue(row, col)
  if (!raw) return 0
  // Handle currency/number formats
  let clean = raw.replace(/[$,%\s]/g, '')
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = `-${clean.slice(1, -1)}`
  }
  return parseFloat(clean) || 0
}

function cellDate(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const raw = cellValue(row, col)
  const match = raw.match(/^Date\((\d+),(\d+),(\d+)\)$/)
  if (!match) return raw
  const [, y, m, d] = match
  return `${Number(m) + 1}/${d}/${y}`
}

function getCategory(cat: string): string {
  const lower = cat.toLowerCase()
  if (lower.includes('roll tech')) return 'Roll Tech'
  if (lower.includes('molding')) return 'Molding'
  if (lower.includes('snap pad')) return 'Snap Pad'
  return 'Other'
}

function normalizeStatus(status: string, ifStatus: string): string {
  const s = (status || ifStatus || '').toLowerCase()
  if (s.includes('cancel') || s.includes('closed') || s.includes('void')) return 'cancelled'
  if (s.includes('shipped') || s.includes('invoiced') || s.includes('to bill')) return 'shipped'
  if (s.includes('staged')) return 'staged'
  if (s.includes('work in progress') || s.includes('wip') || s.includes('in production')) return 'wip'
  if (s.includes('pending') || s.includes('approved') || s.includes('released')) return 'pending'
  return s || 'unknown'
}

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

export async function GET() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${MAIN_DATA_GID}`
    const res = await fetch(url, { next: { revalidate: 60 } })
    const text = await res.text()

    // Google wraps JSON in: /*O_o*/ google.visualization.Query.setResponse({...});
    const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
    const data = JSON.parse(jsonStr)

    const rows = data.table.rows as Array<{ c: Array<{ v: unknown } | null> }>
    const cols = data.table.cols as Array<{ label: string }>

    // Find financial column indices dynamically by label
    let revenueCol = COLS.revenue
    let variableCostCol = COLS.variableCost
    let totalCostCol = COLS.totalCost
    let plCol = COLS.pl

    for (let i = 0; i < cols.length; i++) {
      const label = (cols[i]?.label || '').toLowerCase()
      if (label.includes('revenue') || label.includes('total sell')) revenueCol = i
      if (label.includes('variable cost')) variableCostCol = i
      if (label.includes('total cost') && !label.includes('variable')) totalCostCol = i
      if (label === 'p/l' || label === 'pl' || label.includes('p/l total') || label.includes('profit')) plCol = i
    }

    const orders: SalesOrder[] = []
    let totalRevenue = 0
    let totalCosts = 0
    let totalPL = 0

    for (const row of rows) {
      if (!row.c) continue
      
      const line = cellValue(row, COLS.line)
      const customer = cellValue(row, COLS.customer)
      const partNumber = cellValue(row, COLS.partNumber)
      const categoryRaw = cellValue(row, COLS.category)
      const internalStatus = cellValue(row, COLS.internalStatus)
      const ifStatus = cellValue(row, COLS.ifStatus)
      const status = normalizeStatus(internalStatus, ifStatus)
      
      // Skip empty rows and cancelled orders
      if (!line || !customer) continue
      if (status === 'cancelled') continue
      
      // Only include shipped orders for sales analysis
      if (status !== 'shipped') continue
      
      const qty = cellNumber(row, COLS.orderQty)
      const revenue = cellNumber(row, revenueCol)
      const variableCost = cellNumber(row, variableCostCol)
      const totalCost = cellNumber(row, totalCostCol)
      const pl = cellNumber(row, plCol)
      const shippedDate = cellDate(row, COLS.shippedDate)
      const category = getCategory(categoryRaw)

      // Skip orders with no financial data
      if (revenue === 0 && pl === 0) continue

      orders.push({
        line,
        customer,
        partNumber,
        category,
        qty,
        revenue,
        variableCost,
        totalCost,
        pl,
        shippedDate,
        status,
      })

      totalRevenue += revenue
      totalCosts += totalCost || variableCost
      totalPL += pl
    }

    const avgMargin = totalRevenue > 0 ? (totalPL / totalRevenue) * 100 : 0

    const salesData: SalesData = {
      orders,
      summary: {
        totalRevenue,
        totalCosts,
        totalPL,
        avgMargin,
        orderCount: orders.length,
      },
    }

    return NextResponse.json(salesData)
  } catch (error) {
    console.error('Failed to fetch sales data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sales data' },
      { status: 500 }
    )
  }
}
