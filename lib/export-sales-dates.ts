/**
 * Custom Excel export for Sales by Date — Monthly Orders breakdown.
 * Reverse-engineered from Simon's actual Excel template (Feb 2026).
 *
 * Formatting:
 * - Header: dark blue FF1F3864, white bold Aptos 11, bottom medium border
 * - Alternating rows: FFF2F6FC (blue tint) / FFFFFFFF (white)
 * - Contribution Level: 0.0% with green text FF1A7A2E + 3-color scale (red→white→green)
 * - P/L: green bold (positive) / red bold (negative) + 3-color scale
 * - Profit/Part: green bold (positive) / red bold (negative)
 * - Revenue: $#,##0.00 + blue data bar FF4472C4
 * - Order Qty: #,##0 + light blue data bar FF8FAADC
 * - Currency cols: $#,##0.00
 */

// Column key → number format
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

// Columns with green/red conditional font
const GREEN_RED_COLS = new Set(['pl', 'profitPerPart'])
// Contribution gets green font always (no red)
const GREEN_ONLY_COLS = new Set(['contribution'])

export async function exportSalesDateExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T & string; label: string }[],
  filename: string = 'sales_date_monthly.xlsx'
) {
  if (data.length === 0) return

  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Monthly Orders')

  // Build column index map
  const colIndexByKey = new Map<string, number>()
  columns.forEach((c, i) => colIndexByKey.set(String(c.key), i + 1))

  // --- Header row ---
  const headerRow = ws.addRow(columns.map((c) => c.label))
  headerRow.height = 28
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF0D1B3E' } },
      left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
    }
  })

  // --- Data rows ---
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

    dataRow.eachCell((cell, colNumber) => {
      const colKey = String(columns[colNumber - 1]?.key || '')

      // Default styling
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      }

      // Number format
      const numFmt = NUM_FORMATS[colKey]
      if (numFmt && typeof cell.value === 'number') {
        cell.numFmt = numFmt
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
      }

      // Green/red conditional font for P/L and Profit/Part
      if (GREEN_RED_COLS.has(colKey) && typeof cell.value === 'number') {
        if (cell.value > 0) {
          cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1A7A2E' }, bold: true }
        } else if (cell.value < 0) {
          cell.font = { name: 'Aptos', size: 10, color: { argb: 'FFCC0000' }, bold: true }
        }
      }

      // Contribution Level: always green text
      if (GREEN_ONLY_COLS.has(colKey) && typeof cell.value === 'number') {
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1A7A2E' } }
      }
    })
  })

  const lastDataRow = data.length + 1

  // --- Conditional Formatting: 3-color scales ---
  // Contribution Level column
  const contribCol = colIndexByKey.get('contribution')
  if (contribCol) {
    const colLetter = getColLetter(contribCol)
    ws.addConditionalFormatting({
      ref: `${colLetter}2:${colLetter}${lastDataRow}`,
      rules: [
        {
          type: 'colorScale',
          priority: 1,
          cfvo: [
            { type: 'min' },
            { type: 'num', value: 0 },
            { type: 'max' },
          ],
          color: [
            { argb: 'FFF4CCCC' },
            { argb: 'FFFFFFFF' },
            { argb: 'FFD9EAD3' },
          ],
        } as any,
      ],
    })
  }

  // P/L column: 3-color scale
  const plCol = colIndexByKey.get('pl')
  if (plCol) {
    const colLetter = getColLetter(plCol)
    ws.addConditionalFormatting({
      ref: `${colLetter}2:${colLetter}${lastDataRow}`,
      rules: [
        {
          type: 'colorScale',
          priority: 2,
          cfvo: [
            { type: 'min' },
            { type: 'num', value: 0 },
            { type: 'max' },
          ],
          color: [
            { argb: 'FFF4CCCC' },
            { argb: 'FFFFFFFF' },
            { argb: 'FFD9EAD3' },
          ],
        } as any,
      ],
    })
  }

  // Revenue column: blue data bar
  const revCol = colIndexByKey.get('revenue')
  if (revCol) {
    const colLetter = getColLetter(revCol)
    ws.addConditionalFormatting({
      ref: `${colLetter}2:${colLetter}${lastDataRow}`,
      rules: [
        {
          type: 'dataBar',
          priority: 3,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: { argb: 'FF4472C4' },
          showValue: true,
        } as any,
      ],
    })
  }

  // Order Qty column: light blue data bar
  const qtyCol = colIndexByKey.get('qty')
  if (qtyCol) {
    const colLetter = getColLetter(qtyCol)
    ws.addConditionalFormatting({
      ref: `${colLetter}2:${colLetter}${lastDataRow}`,
      rules: [
        {
          type: 'dataBar',
          priority: 4,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: { argb: 'FF8FAADC' },
          showValue: true,
        } as any,
      ],
    })
  }

  // --- Column widths (from template) ---
  const TEMPLATE_WIDTHS: Record<string, number> = {
    category: 12.1,
    dateOfRequest: 15,
    ifNumber: 13.6,
    ifStatusFusion: 16.4,
    internalStatus: 15.7,
    poNumber: 22.1,
    customer: 30,
    partNumber: 18.6,
    qty: 11.4,
    requestedDate: 15,
    unitPrice: 12.1,
    contribution: 15,
    variableCost: 13.6,
    totalCost: 12.1,
    salesTarget: 15,
    profitPerPart: 12.9,
    pl: 14.3,
    revenue: 14.3,
    shippedDate: 14.3,
    shippingCost: 14.3,
  }

  columns.forEach((col, i) => {
    const templateWidth = TEMPLATE_WIDTHS[String(col.key)]
    if (templateWidth) {
      ws.getColumn(i + 1).width = templateWidth
    } else {
      // Fallback: auto-size
      let maxLen = col.label.length
      const sampleSize = Math.min(data.length, 200)
      for (let r = 0; r < sampleSize; r++) {
        const len = String(data[r][col.key] ?? '').length
        if (len > maxLen) maxLen = len
      }
      ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 4, 10), 35)
    }
  })

  // Freeze header + auto filter
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: lastDataRow, column: columns.length },
  }

  // Generate and download
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  link.click()
  URL.revokeObjectURL(url)
}

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
