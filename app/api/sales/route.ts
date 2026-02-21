import { NextResponse } from 'next/server'

// 2026-02-21: Switched to Google Sheets primary (Supabase had stale data, no sync job)

const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
const MAIN_DATA_GID = '290032634'

export async function GET() {
  try {
    return await fetchSalesFromSheets()
  } catch (error) {
    console.error('Failed to fetch sales data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sales data' },
      { status: 500 }
    )
  }
}

// ─── Google Sheets implementation ───

function cellValue(row: { c: Array<{ v: unknown } | null> }, col: number): string {
  const cell = row.c?.[col]
  if (!cell || cell.v === null || cell.v === undefined) return ''
  return String(cell.v)
}

function cellNumber(row: { c: Array<{ v: unknown } | null> }, col: number): number {
  const raw = cellValue(row, col)
  if (!raw) return 0
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
  const lower = cat.toLowerCase().trim()
  if (lower.includes('roll tech')) return 'Roll Tech'
  if (lower.includes('molding')) return 'Molding'
  if (lower.includes('snap pad') || lower.includes('snap-pad') || lower.includes('snappad')) return 'Snap Pad'
  if (lower.includes('missing') || lower.includes('reference data')) return 'Roll Tech'
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

const COLS = {
  line: 0, category: 1, dateOfRequest: 2, priorityLevel: 3, urgentOverride: 4,
  ifNumber: 5, ifStatus: 6, internalStatus: 7, poNumber: 8, customer: 9,
  partNumber: 11, orderQty: 15, requestedDate: 22, shippedDate: 45,
  revenue: 44, variableCost: 39, totalCost: 40, pl: 43,
}

async function fetchSalesFromSheets() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${MAIN_DATA_GID}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  const text = await res.text()
  const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
  const data = JSON.parse(jsonStr)

  const rows = data.table.rows as Array<{ c: Array<{ v: unknown } | null> }>
  const cols = data.table.cols as Array<{ label: string }>

  let revenueCol = COLS.revenue, variableCostCol = COLS.variableCost
  let totalCostCol = COLS.totalCost, plCol = COLS.pl

  for (let i = 0; i < cols.length; i++) {
    const label = (cols[i]?.label || '').toLowerCase()
    if (label.includes('revenue') || label.includes('total sell')) revenueCol = i
    if (label.includes('variable cost')) variableCostCol = i
    if (label.includes('total cost') && !label.includes('variable')) totalCostCol = i
    if (label === 'p/l' || label === 'pl' || label.includes('p/l total') || label.includes('profit')) plCol = i
  }

  const orders: Array<{ line: string; customer: string; partNumber: string; category: string; qty: number; revenue: number; variableCost: number; totalCost: number; pl: number; shippedDate: string; requestedDate: string; status: string }> = []
  let totalRevenue = 0, totalCosts = 0, totalPL = 0

  for (const row of rows) {
    if (!row.c) continue
    const line = cellValue(row, COLS.line)
    const customer = cellValue(row, COLS.customer)
    if (!line || !customer) continue
    const status = normalizeStatus(cellValue(row, COLS.internalStatus), cellValue(row, COLS.ifStatus))
    if (status === 'cancelled') continue

    const revenue = cellNumber(row, revenueCol)
    const variableCost = cellNumber(row, variableCostCol)
    const totalCost = cellNumber(row, totalCostCol)
    const pl = cellNumber(row, plCol)
    if (revenue === 0 && pl === 0) continue

    orders.push({
      line, customer, partNumber: cellValue(row, COLS.partNumber),
      category: getCategory(cellValue(row, COLS.category)),
      qty: cellNumber(row, COLS.orderQty), revenue, variableCost, totalCost, pl,
      shippedDate: cellDate(row, COLS.shippedDate),
      requestedDate: cellDate(row, COLS.requestedDate),
      status,
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
  return NextResponse.json({
    orders,
    summary: { totalRevenue, totalCosts, totalPL, avgMargin, orderCount: orders.length, shippedPL, shippedCount, forecastPL, pendingCount },
  })
}
