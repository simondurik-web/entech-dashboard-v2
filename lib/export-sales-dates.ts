/**
 * Custom Excel export for Sales by Date — Monthly Orders breakdown.
 * Matches Simon's Excel template (Feb 2026).
 * 
 * Key differences from generic export:
 * - Contribution Level formatted as percentage (0.0%)
 * - Specific number formats per column
 * - Header: dark blue FF1F3864, white bold text (Aptos 11)
 * - Alternating rows: FFF2F6FC / FFFFFFFF
 */

// Column-specific number formats
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

export async function exportSalesDateExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T & string; label: string }[],
  filename: string = 'sales_date_monthly.xlsx'
) {
  if (data.length === 0) return

  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Monthly Orders')

  // Header row — uniform dark blue
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

  // Data rows
  data.forEach((row, ri) => {
    const values = columns.map((c) => {
      const val = row[c.key]
      if (val === null || val === undefined) return ''
      // For contribution (margin %), convert from 0-100 to 0-1 for Excel percentage format
      if (c.key === 'contribution' && typeof val === 'number') return val / 100
      if (typeof val === 'number') return val
      const str = String(val)
      const num = Number(str)
      if (!isNaN(num) && str.trim() !== '' && !/^0\d/.test(str.trim())) return num
      return str
    })
    const dataRow = ws.addRow(values)
    dataRow.height = 22
    const bgColor = ri % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF'
    dataRow.eachCell((cell, colNumber) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      }

      // Apply column-specific number format
      const colKey = String(columns[colNumber - 1]?.key || '')
      const numFmt = NUM_FORMATS[colKey]
      if (numFmt && typeof cell.value === 'number') {
        cell.numFmt = numFmt
        cell.alignment = { horizontal: 'right', vertical: 'middle' }
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
    ws.getColumn(i + 1).width = Math.min(Math.max(maxLen + 4, 10), 35)
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
