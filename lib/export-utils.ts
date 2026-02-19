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
  const ws = wb.addWorksheet('Data', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  // Header row
  const headerRow = ws.addRow(columns.map((c) => c.label))
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }, // Blue matching the HTML dashboard
    }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF3B6AB5' } },
    }
  })
  headerRow.height = 28

  // Data rows
  data.forEach((row) => {
    const values = columns.map((c) => {
      const val = row[c.key]
      if (val === null || val === undefined) return ''
      if (typeof val === 'number') return val
      // Try to parse numeric strings
      const str = String(val)
      const num = Number(str)
      if (!isNaN(num) && str.trim() !== '' && !/^0\d/.test(str.trim())) return num
      return str
    })
    ws.addRow(values)
  })

  // Auto-filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: data.length + 1, column: columns.length },
  }

  // Auto-width columns (based on header + sample data)
  columns.forEach((col, i) => {
    const colObj = ws.getColumn(i + 1)
    let maxLen = col.label.length
    const sampleSize = Math.min(data.length, 100)
    for (let r = 0; r < sampleSize; r++) {
      const val = data[r][col.key]
      const len = String(val ?? '').length
      if (len > maxLen) maxLen = len
    }
    colObj.width = Math.min(Math.max(maxLen + 3, 8), 45)
  })

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
