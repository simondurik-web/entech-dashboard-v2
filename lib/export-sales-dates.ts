/**
 * Custom Excel export for Sales by Date — Monthly Orders breakdown.
 * Reverse-engineered from Simon's actual Excel template (Feb 2026).
 *
 * Tab 1: Monthly Orders — data + SUBTOTAL totals row
 * Tab 2: Dashboard — pre-computed summaries with charts
 *
 * Formatting:
 * - Header: dark blue FF1F3864, white bold Aptos 11
 * - Alternating rows: FFF2F6FC / FFFFFFFF
 * - Contribution Level: 0.0% green text + 3-color scale
 * - P/L: green/red bold + 3-color scale
 * - Revenue: blue data bar FF4472C4
 * - Order Qty: light blue data bar FF8FAADC
 * - Totals row: dark blue bg, white bold, SUBTOTAL formulas
 */

const NUM_FORMATS: Record<string, string> = {
  qty: '#,##0',
  unitPrice: '$#,##0.00',
  contribution: '0.0%',
  variableCost: '$#,##0.00',
  totalCost: '$#,##0.00',
  salesTarget: '$#,##0.00',
  profitPerPart: '$#,##0.00',
  pl: '$#,##0.00',
  revenue: '$#,##0.00',
  shippingCost: '$#,##0.00',
}

const GREEN_RED_COLS = new Set(['pl', 'profitPerPart'])
const GREEN_ONLY_COLS = new Set(['contribution'])

// Columns to SUM in totals row (SUBTOTAL 109)
const SUM_COLS = new Set(['qty', 'pl', 'revenue'])
// Columns to AVERAGE in totals row (SUBTOTAL 101)
const AVG_COLS = new Set(['contribution'])

function getColLetter(colNum: number): string {
  let letter = ''
  let n = colNum
  while (n > 0) {
    n--
    letter = String.fromCharCode(65 + (n % 26)) + letter
    n = Math.floor(n / 26)
  }
  return letter
}

// Shared header style
function applyHeaderStyle(cell: any) {
  cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  cell.border = {
    bottom: { style: 'medium', color: { argb: 'FF0D1B3E' } },
    left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
    right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
  }
}

export async function exportSalesDateExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T & string; label: string }[],
  filename: string = 'sales_date_monthly.xlsx'
) {
  if (data.length === 0) return

  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()

  // ═══════════════════════════════════════════════════
  // TAB 1: Monthly Orders (data + totals)
  // ═══════════════════════════════════════════════════
  const ws = wb.addWorksheet('Monthly Orders')
  const colIndexByKey = new Map<string, number>()
  columns.forEach((c, i) => colIndexByKey.set(String(c.key), i + 1))

  // Header row
  const headerRow = ws.addRow(columns.map((c) => c.label))
  headerRow.height = 28
  headerRow.eachCell((cell) => applyHeaderStyle(cell))

  // Data rows
  data.forEach((row, ri) => {
    const values = columns.map((c) => {
      const val = row[c.key]
      if (val === null || val === undefined) return ''
      if (c.key === 'contribution' && typeof val === 'number') return val / 100
      if (typeof val === 'number') return val
      const s = String(val)
      const n = Number(s)
      if (!isNaN(n) && s.trim() !== '' && !/^0\d/.test(s.trim())) return n
      return s
    })
    const dataRow = ws.addRow(values)
    dataRow.height = 22
    const bgColor = ri % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF'

    dataRow.eachCell((cell: any, colNumber: number) => {
      const colKey = String(columns[colNumber - 1]?.key || '')
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      }
      const numFmt = NUM_FORMATS[colKey]
      if (numFmt && typeof cell.value === 'number') {
        cell.numFmt = numFmt
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
      }
      if (GREEN_RED_COLS.has(colKey) && typeof cell.value === 'number') {
        cell.font = cell.value > 0
          ? { name: 'Aptos', size: 10, color: { argb: 'FF1A7A2E' }, bold: true }
          : cell.value < 0
            ? { name: 'Aptos', size: 10, color: { argb: 'FFCC0000' }, bold: true }
            : cell.font
      }
      if (GREEN_ONLY_COLS.has(colKey) && typeof cell.value === 'number') {
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1A7A2E' } }
      }
    })
  })

  // Empty spacer row
  const spacerRowNum = data.length + 2
  ws.addRow([])

  // TOTALS row — dark blue bg, white bold, SUBTOTAL formulas
  const totalsValues = columns.map((c) => {
    const colKey = String(c.key)
    if (colKey === 'category') return 'TOTALS'
    return ''
  })
  const totalsRow = ws.addRow(totalsValues)
  const totalsRowNum = spacerRowNum + 1
  totalsRow.height = 28

  totalsRow.eachCell((cell: any, colNumber: number) => {
    const colKey = String(columns[colNumber - 1]?.key || '')
    // Dark blue header style for all totals cells
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = {
      top: { style: 'medium', color: { argb: 'FF0D1B3E' } },
      bottom: { style: 'medium', color: { argb: 'FF0D1B3E' } },
      left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
    }

    // Apply number format
    const numFmt = NUM_FORMATS[colKey]
    if (numFmt) {
      cell.numFmt = numFmt
      cell.alignment = { horizontal: 'right', vertical: 'middle' }
    }

    // Apply SUBTOTAL formulas
    const colLetter = getColLetter(colNumber)
    const dataRange = `${colLetter}2:${colLetter}${data.length + 1}`
    if (SUM_COLS.has(colKey)) {
      cell.value = { formula: `SUBTOTAL(109,${dataRange})` }
      // Green font for P/L total
      if (colKey === 'pl') {
        cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF4ADE80' } }
      }
    } else if (AVG_COLS.has(colKey)) {
      cell.value = { formula: `SUBTOTAL(101,${dataRange})` }
    }
  })

  // Also fill empty totals cells with dark blue bg
  for (let c = 1; c <= columns.length; c++) {
    const cell = ws.getRow(totalsRowNum).getCell(c)
    if (!cell.fill || (cell.fill as any).fgColor?.argb !== 'FF1F3864') {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
      cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF0D1B3E' } },
        bottom: { style: 'medium', color: { argb: 'FF0D1B3E' } },
        left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      }
    }
  }

  // Conditional formatting
  const lastDataRow = data.length + 1

  // Contribution Level: 3-color scale
  const contribCol = colIndexByKey.get('contribution')
  if (contribCol) {
    ws.addConditionalFormatting({
      ref: `${getColLetter(contribCol)}2:${getColLetter(contribCol)}${lastDataRow}`,
      rules: [{
        type: 'colorScale', priority: 1,
        cfvo: [{ type: 'min' }, { type: 'num', value: 0 }, { type: 'max' }],
        color: [{ argb: 'FFF4CCCC' }, { argb: 'FFFFFFFF' }, { argb: 'FFD9EAD3' }],
      } as any],
    })
  }

  // P/L: 3-color scale
  const plCol = colIndexByKey.get('pl')
  if (plCol) {
    ws.addConditionalFormatting({
      ref: `${getColLetter(plCol)}2:${getColLetter(plCol)}${lastDataRow}`,
      rules: [{
        type: 'colorScale', priority: 2,
        cfvo: [{ type: 'min' }, { type: 'num', value: 0 }, { type: 'max' }],
        color: [{ argb: 'FFF4CCCC' }, { argb: 'FFFFFFFF' }, { argb: 'FFD9EAD3' }],
      } as any],
    })
  }

  // Revenue: blue data bar
  const revCol = colIndexByKey.get('revenue')
  if (revCol) {
    ws.addConditionalFormatting({
      ref: `${getColLetter(revCol)}2:${getColLetter(revCol)}${lastDataRow}`,
      rules: [{
        type: 'dataBar', priority: 3,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF4472C4' }, showValue: true,
      } as any],
    })
  }

  // Order Qty: light blue data bar
  const qtyCol = colIndexByKey.get('qty')
  if (qtyCol) {
    ws.addConditionalFormatting({
      ref: `${getColLetter(qtyCol)}2:${getColLetter(qtyCol)}${lastDataRow}`,
      rules: [{
        type: 'dataBar', priority: 4,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF8FAADC' }, showValue: true,
      } as any],
    })
  }

  // Column widths
  const TEMPLATE_WIDTHS: Record<string, number> = {
    category: 12.1, dateOfRequest: 15, ifNumber: 13.6, ifStatusFusion: 16.4,
    ifStatus: 16.4, internalStatus: 15.7, poNumber: 22.1, customer: 30,
    partNumber: 18.6, qty: 11.4, requestedDate: 15, unitPrice: 12.1,
    contribution: 15, variableCost: 13.6, totalCost: 12.1, salesTarget: 15,
    profitPerPart: 12.9, pl: 14.3, revenue: 14.3, shippedDate: 14.3, shippingCost: 14.3,
  }
  columns.forEach((col, i) => {
    const w = TEMPLATE_WIDTHS[String(col.key)]
    ws.getColumn(i + 1).width = w || Math.min(Math.max(String(col.label).length + 4, 10), 35)
  })

  // Freeze header + auto filter (data range only, not totals) + hide gridlines
  ws.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastDataRow, column: columns.length } }

  // ═══════════════════════════════════════════════════
  // TAB 2: Dashboard — summaries + charts
  // ═══════════════════════════════════════════════════
  buildDashboardTab(wb, data, columns)

  // Generate and download
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}

// ─── Dashboard Tab Builder ───

interface SummaryRow {
  label: string
  orders: number
  totalQty: number
  revenue: number
  pl: number
  avgMargin: number
}

function buildDashboardTab<T extends Record<string, unknown>>(
  wb: any,
  data: T[],
  columns: { key: keyof T & string; label: string }[]
) {
  const ds = wb.addWorksheet('Dashboard')

  // Pre-compute aggregations
  const byCustomer = aggregate(data, 'customer')
  const byCategory = aggregate(data, 'category')
  const byStatus = aggregate(data, 'internalStatus')

  // Sort by revenue descending
  byCustomer.sort((a, b) => b.revenue - a.revenue)
  byCategory.sort((a, b) => b.revenue - a.revenue)

  // ── Title ──
  let currentRow = 1
  const titleCell = ds.getCell('A1')
  titleCell.value = 'Sales Dashboard — Monthly Summary'
  titleCell.font = { name: 'Aptos', size: 16, bold: true, color: { argb: 'FF1F3864' } }
  ds.mergeCells('A1:H1')
  ds.getRow(1).height = 32

  // ── KPI Cards Row ──
  currentRow = 3
  const totalOrders = data.length
  const totalQty = sumField(data, 'qty')
  const totalRevenue = sumField(data, 'revenue')
  const totalPL = sumField(data, 'pl')
  const avgMargin = data.length > 0
    ? data.reduce((s, r) => s + (Number(r.contribution) || 0), 0) / data.length
    : 0

  const kpis = [
    { label: 'Total Orders', value: totalOrders, fmt: '#,##0' },
    { label: 'Total Qty', value: totalQty, fmt: '#,##0' },
    { label: 'Total Revenue', value: totalRevenue, fmt: '$#,##0.00' },
    { label: 'Total P/L', value: totalPL, fmt: '$#,##0.00' },
    { label: 'Avg Margin', value: avgMargin / 100, fmt: '0.0%' },
  ]

  // KPI labels row
  kpis.forEach((kpi, i) => {
    const col = i * 2 + 1
    const labelCell = ds.getCell(currentRow, col)
    labelCell.value = kpi.label
    labelCell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FF6B7280' } }
    labelCell.alignment = { horizontal: 'center' }
    ds.mergeCells(currentRow, col, currentRow, col + 1)
  })

  // KPI values row
  currentRow = 4
  kpis.forEach((kpi, i) => {
    const col = i * 2 + 1
    const valCell = ds.getCell(currentRow, col)
    valCell.value = kpi.value
    valCell.numFmt = kpi.fmt
    valCell.font = {
      name: 'Aptos', size: 18, bold: true,
      color: { argb: kpi.label === 'Total P/L' ? (kpi.value >= 0 ? 'FF1A7A2E' : 'FFCC0000') : 'FF1F3864' },
    }
    valCell.alignment = { horizontal: 'center' }
    ds.mergeCells(currentRow, col, currentRow, col + 1)
  })

  // ── Section 1: Revenue by Customer (Top 15) ──
  currentRow = 7
  const custSection = writeTable(ds, currentRow, 'Revenue by Customer (Top 15)', byCustomer.slice(0, 15))
  currentRow = custSection.endRow

  // Chart: Top 10 Customers by Revenue
  addBarChart(wb, ds, 'Top 10 Customers — Revenue',
    byCustomer.slice(0, 10).map(r => r.label),
    byCustomer.slice(0, 10).map(r => r.revenue),
    'H', 7, 'R', 22, 'FF4472C4')

  // ── Section 2: Revenue by Category ──
  currentRow += 2
  const catSection = writeTable(ds, currentRow, 'Revenue by Category', byCategory)
  currentRow = catSection.endRow

  // Chart: Category breakdown
  addBarChart(wb, ds, 'Revenue by Category',
    byCategory.map(r => r.label),
    byCategory.map(r => r.revenue),
    'H', 24, 'R', 37, 'FF8FAADC')

  // ── Section 3: Orders by Status ──
  currentRow += 2
  writeTable(ds, currentRow, 'Orders by Status', byStatus)

  // P/L by Customer chart
  addBarChart(wb, ds, 'P/L by Customer (Top 10)',
    byCustomer.slice(0, 10).map(r => r.label),
    byCustomer.slice(0, 10).map(r => r.pl),
    'H', 39, 'R', 54, 'FF1A7A2E')

  // Column widths for dashboard
  ds.getColumn(1).width = 30
  for (let i = 2; i <= 6; i++) ds.getColumn(i).width = 16
  for (let i = 7; i <= 18; i++) ds.getColumn(i).width = 12

  // Freeze title + hide gridlines
  ds.views = [{ state: 'frozen', ySplit: 2, showGridLines: false }]
}

function aggregate<T extends Record<string, unknown>>(data: T[], groupKey: string): SummaryRow[] {
  const map = new Map<string, { orders: number; qty: number; revenue: number; pl: number; margins: number[] }>()

  for (const row of data) {
    const key = String(row[groupKey] || 'Unknown').trim() || 'Unknown'
    let g = map.get(key)
    if (!g) { g = { orders: 0, qty: 0, revenue: 0, pl: 0, margins: [] }; map.set(key, g) }
    g.orders++
    g.qty += Number(row.qty) || 0
    g.revenue += Number(row.revenue) || 0
    g.pl += Number(row.pl) || 0
    const m = Number(row.contribution)
    if (!isNaN(m)) g.margins.push(m)
  }

  return Array.from(map.entries()).map(([label, g]) => ({
    label,
    orders: g.orders,
    totalQty: g.qty,
    revenue: g.revenue,
    pl: g.pl,
    avgMargin: g.margins.length > 0 ? g.margins.reduce((a, b) => a + b, 0) / g.margins.length : 0,
  }))
}

function sumField<T extends Record<string, unknown>>(data: T[], key: string): number {
  return data.reduce((s, r) => s + (Number(r[key]) || 0), 0)
}

function writeTable(ws: any, startRow: number, title: string, rows: SummaryRow[]) {
  // Section title
  const titleCell = ws.getCell(startRow, 1)
  titleCell.value = title
  titleCell.font = { name: 'Aptos', size: 12, bold: true, color: { argb: 'FF1F3864' } }
  ws.mergeCells(startRow, 1, startRow, 6)

  // Table header
  const hdrRow = startRow + 1
  const headers = ['Name', 'Orders', 'Total Qty', 'Revenue', 'P/L', 'Avg Margin']
  const fmts = ['', '#,##0', '#,##0', '$#,##0.00', '$#,##0.00', '0.0%']
  headers.forEach((h, i) => {
    const cell = ws.getCell(hdrRow, i + 1)
    cell.value = h
    applyHeaderStyle(cell)
  })
  ws.getRow(hdrRow).height = 24

  // Table data
  rows.forEach((r, ri) => {
    const rowNum = hdrRow + 1 + ri
    const vals = [r.label, r.orders, r.totalQty, r.revenue, r.pl, r.avgMargin / 100]
    vals.forEach((v, ci) => {
      const cell = ws.getCell(rowNum, ci + 1)
      cell.value = v
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF' } }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      }
      if (fmts[ci]) {
        cell.numFmt = fmts[ci]
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
      }
      // Green/red for P/L
      if (ci === 4 && typeof v === 'number') {
        cell.font = v >= 0
          ? { name: 'Aptos', size: 10, color: { argb: 'FF1A7A2E' }, bold: true }
          : { name: 'Aptos', size: 10, color: { argb: 'FFCC0000' }, bold: true }
      }
    })
  })

  return { endRow: hdrRow + 1 + rows.length }
}

function addBarChart(
  wb: any, ws: any, title: string,
  labels: string[], values: number[],
  startCol: string, startRow: number,
  endCol: string, endRow: number,
  color: string
) {
  // ExcelJS doesn't support charts natively, so we'll write the data as a mini-table
  // that users can select to create a chart, and add a note
  const noteCell = ws.getCell(`${startCol}${startRow}`)
  noteCell.value = `📊 ${title}`
  noteCell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FF1F3864' } }

  // Write chart data as a small table
  const dataStartRow = startRow + 1
  // Header
  const hCol1 = startCol
  const hCol2 = String.fromCharCode(startCol.charCodeAt(0) + 1)

  ws.getCell(`${hCol1}${dataStartRow}`).value = 'Name'
  ws.getCell(`${hCol2}${dataStartRow}`).value = 'Value'

  const hdrCells = [ws.getCell(`${hCol1}${dataStartRow}`), ws.getCell(`${hCol2}${dataStartRow}`)]
  hdrCells.forEach(c => {
    c.font = { name: 'Aptos', size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    c.alignment = { horizontal: 'center' }
  })

  labels.forEach((label, i) => {
    const r = dataStartRow + 1 + i
    const nameCell = ws.getCell(`${hCol1}${r}`)
    nameCell.value = label
    nameCell.font = { name: 'Aptos', size: 9, color: { argb: 'FF2D2D2D' } }
    nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF' } }

    const valCell = ws.getCell(`${hCol2}${r}`)
    valCell.value = values[i]
    valCell.numFmt = '$#,##0.00'
    valCell.font = { name: 'Aptos', size: 9, color: { argb: 'FF2D2D2D' } }
    valCell.fill = nameCell.fill
    valCell.alignment = { horizontal: 'right' }

    // Simple visual bar using repeated characters
    const maxVal = Math.max(...values.map(Math.abs))
    if (maxVal > 0) {
      const barCol = String.fromCharCode(startCol.charCodeAt(0) + 2)
      const barLen = Math.round((Math.abs(values[i]) / maxVal) * 20)
      const barCell = ws.getCell(`${barCol}${r}`)
      barCell.value = '█'.repeat(barLen)
      barCell.font = {
        name: 'Aptos', size: 9,
        color: { argb: values[i] >= 0 ? 'FF4472C4' : 'FFCC0000' },
      }
    }
  })
}
