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

  // Dynamic import to avoid bundling xlsx for all pages
  const XLSX = await import('xlsx')

  const headers = columns.map((c) => c.label)
  const rows = data.map((row) =>
    columns.map((c) => {
      const val = row[c.key]
      if (val === null || val === undefined) return ''
      if (typeof val === 'number') return val
      return String(val)
    })
  )

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])

  // Auto-width columns
  ws['!cols'] = columns.map((col, i) => {
    const maxLen = Math.max(
      col.label.length,
      ...rows.map((r) => String(r[i] ?? '').length)
    )
    return { wch: Math.min(Math.max(maxLen + 2, 8), 50) }
  })

  // Freeze first row (header)
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', state: 'frozen' }
  // Also set as views for broader compatibility
  if (!ws['!views']) ws['!views'] = []
  ;(ws['!views'] as Array<{ state: string; ySplit: number }>).push({ state: 'frozen', ySplit: 1 })

  // Style header row — bold with dark background
  // Note: xlsx community edition has limited styling; use cell metadata
  for (let c = 0; c < columns.length; c++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[cellRef]) {
      ws[cellRef].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '2D3748' } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: {
          bottom: { style: 'thin', color: { rgb: '000000' } },
        },
      }
    }
  }

  // Auto-filter on header row
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: columns.length - 1 } }) }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Data')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`, { bookSST: true })
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
