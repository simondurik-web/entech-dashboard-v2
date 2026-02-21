/**
 * Custom Excel export for Sales by Date — Monthly Orders breakdown.
 * Matches the formatted spreadsheet Simon designed (Feb 2026).
 * Each column header has a specific color.
 */

// Header colors per column (ARGB format) — matches Simon's Excel template
const HEADER_COLORS: Record<string, string> = {
  category: 'FF548235',        // green
  dateOfRequest: 'FFED7D31',   // orange
  ifNumber: 'FF4472C4',        // blue/teal
  ifStatus: 'FF548235',        // green
  internalStatus: 'FFED7D31',  // orange/amber
  poNumber: 'FFFF0000',        // red
  customer: 'FFFFC000',        // yellow/gold
  partNumber: 'FF70AD47',      // light green
  qty: 'FF4472C4',             // blue
  requestedDate: 'FF548235',   // green
  unitPrice: 'FFFFC000',       // yellow/gold
  contribution: 'FFED7D31',    // orange
  variableCost: 'FFFF0000',    // red
  totalCost: 'FFC00000',       // dark red/maroon
  salesTarget: 'FF548235',     // green
  profitPerPart: 'FF4472C4',   // blue
  pl: 'FF548235',              // green
  revenue: 'FFFFC000',         // gold/yellow
  shippedDate: 'FFED7D31',     // orange
  shippingCost: 'FFFF0000',    // red
}

// Font color: white for dark backgrounds, black for light backgrounds
function getHeaderFontColor(bgColor: string): string {
  // Yellow/gold headers need dark text
  if (bgColor === 'FFFFC000') return 'FF000000'
  return 'FFFFFFFF'
}

export async function exportSalesDateExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T & string; label: string }[],
  filename: string = 'sales_date_monthly.xlsx'
) {
  if (data.length === 0) return

  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Monthly Orders')

  // Header row — each column gets its own color
  const headerRow = ws.addRow(columns.map((c) => c.label))
  headerRow.height = 30
  headerRow.eachCell((cell, colNumber) => {
    const colKey = columns[colNumber - 1]?.key || ''
    const bgColor = HEADER_COLORS[colKey] || 'FF1F3864'
    const fontColor = getHeaderFontColor(bgColor)

    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: fontColor } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      bottom: { style: 'medium', color: { argb: 'FF333333' } },
      left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
    }
  })

  // Data rows
  data.forEach((row, ri) => {
    const values = columns.map((c) => {
      const val = row[c.key]
      if (val === null || val === undefined) return ''
      if (typeof val === 'number') return val
      const str = String(val)
      const num = Number(str)
      if (!isNaN(num) && str.trim() !== '' && !/^0\d/.test(str.trim())) return num
      return str
    })
    const dataRow = ws.addRow(values)
    dataRow.height = 20
    const bgColor = ri % 2 === 0 ? 'FFFFFFFF' : 'FFF2F6FC'
    dataRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      }

      // Number formatting
      if (typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
        const colLabel = columns[colNumber - 1]?.label?.toLowerCase() || ''
        const colKey = columns[colNumber - 1]?.key?.toLowerCase() || ''
        const isCurrency = ['revenue', 'cost', 'p/l', 'pl', 'price', 'profit', 'target', 'shipping'].some(
          kw => colLabel.includes(kw) || colKey.includes(kw)
        )
        if (isCurrency) {
          cell.numFmt = '$#,##0.00'
        } else {
          cell.numFmt = '#,##0'
        }
      }
    })
  })

  // Auto column widths
  columns.forEach((col, i) => {
    let maxLen = col.label.length
    const sampleSize = Math.min(data.length, 200)
    for (let r = 0; r < sampleSize; r++) {
      const len = String(data[r][col.key] ?? '').length
      if (len > maxLen) maxLen = len
    }
    ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 4, 10), 40)
  })

  // Freeze header + auto filter
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: data.length + 1, column: columns.length },
  }

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
