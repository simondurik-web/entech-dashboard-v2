/**
 * Export utilities — CSV and Excel (XLSX)
 * Respects current view: visible columns, sort order, filters
 */

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T & string; label: string }[],
  filename: string = 'export.csv'
) {
  if (data.length === 0) return

  const header = columns.map((c) => escapeCSV(c.label)).join(',')
  const rows = data.map((row) =>
    columns.map((c) => escapeCSV(String(row[c.key] ?? ''))).join(',')
  )
  const csv = [header, ...rows].join('\n')

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, filename.endsWith('.csv') ? filename : `${filename}.csv`)
}

export async function exportToExcel<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T & string; label: string }[],
  filename: string = 'export.xlsx'
) {
  if (data.length === 0) return

  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Data')

  // Header row — matches HTML production dashboard exactly
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

  // Data rows with alternating row colors
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
    dataRow.height = 22
    const bgColor = ri % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF'
    dataRow.eachCell((cell) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } }
      cell.alignment = { horizontal: 'left', vertical: 'middle' }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
      }
      // Center-align numbers
      if (typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.numFmt = '#,##0'
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

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
