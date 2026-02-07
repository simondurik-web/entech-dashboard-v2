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

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
