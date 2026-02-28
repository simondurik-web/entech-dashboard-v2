'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import type { ScheduleEntry, ScheduleEmployee } from './ScheduleGrid'

interface ScheduleExportProps {
  entries: ScheduleEntry[]
  employees: ScheduleEmployee[]
  weekDates: Date[]
  weekLabel: string
}

interface FlatRow {
  employee: string
  employee_id: string
  department: string
  shift: string
  [key: string]: string
}

function buildRows(
  entries: ScheduleEntry[],
  employees: ScheduleEmployee[],
  weekDates: Date[],
  language: string
): { rows: FlatRow[]; dayCols: { key: string; label: string; date: Date }[] } {
  // Day columns
  const dayCols = weekDates.map((d) => {
    const dayName = d.toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', { weekday: 'short' })
    const dateStr = d.toISOString().split('T')[0]
    const label = `${dayName} ${d.getMonth() + 1}/${d.getDate()}`
    return { key: dateStr, label, date: d }
  })

  // Build entry lookup
  const entryMap = new Map<string, ScheduleEntry>()
  for (const e of entries) {
    entryMap.set(`${e.employee_id}::${e.date}`, e)
  }

  // Build rows
  const rows: FlatRow[] = employees
    .filter((e) => e.is_active !== false)
    .sort((a, b) => a.last_name.localeCompare(b.last_name))
    .map((emp) => {
      const row: FlatRow = {
        employee: `${emp.last_name}, ${emp.first_name}`,
        employee_id: emp.employee_id,
        department: emp.department,
        shift: emp.default_shift === 1 ? 'Shift 1' : 'Shift 2',
      }
      for (const col of dayCols) {
        const entry = entryMap.get(`${emp.employee_id}::${col.key}`)
        if (entry) {
          const start = formatTimeShort(entry.start_time)
          const end = formatTimeShort(entry.end_time)
          const machine = entry.machine_name ? ` (${entry.machine_name})` : ''
          row[col.key] = `${start}-${end}${machine}`
        } else {
          row[col.key] = '—'
        }
      }
      return row
    })

  return { rows, dayCols }
}

function formatTimeShort(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'p' : 'a'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${h12}:${m}${ampm}`
}

// --- CSV Export ---
function exportCSV(rows: FlatRow[], dayCols: { key: string; label: string }[], weekLabel: string) {
  const cols = [
    { key: 'employee', label: 'Employee' },
    { key: 'employee_id', label: 'ID' },
    { key: 'department', label: 'Department' },
    { key: 'shift', label: 'Default Shift' },
    ...dayCols.map((d) => ({ key: d.key, label: d.label })),
  ]
  const esc = (s: string) => {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = cols.map((c) => esc(c.label)).join(',')
  const lines = rows.map((r) => cols.map((c) => esc(r[c.key] || '—')).join(','))
  const csv = [header, ...lines].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `schedule-${weekLabel.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// --- Excel Export ---
async function exportExcel(rows: FlatRow[], dayCols: { key: string; label: string }[], weekLabel: string) {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Schedule')

  const cols = [
    { key: 'employee', label: 'Employee', width: 25 },
    { key: 'employee_id', label: 'ID', width: 8 },
    { key: 'department', label: 'Department', width: 15 },
    { key: 'shift', label: 'Shift', width: 10 },
    ...dayCols.map((d) => ({ key: d.key, label: d.label, width: 18 })),
  ]

  // Title row
  ws.mergeCells(1, 1, 1, cols.length)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = `Employee Schedule — ${weekLabel}`
  titleCell.font = { name: 'Aptos', size: 14, bold: true, color: { argb: 'FF1F3864' } }
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 32

  // Header row
  const headerRow = ws.addRow(cols.map((c) => c.label))
  headerRow.height = 28
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Aptos', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF0D1B3E' } },
    }
  })

  // Set column widths
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  // Data rows with alternating colors
  rows.forEach((row, ri) => {
    const values = cols.map((c) => row[c.key] || '—')
    const dataRow = ws.addRow(values)
    dataRow.height = 22
    const bg = ri % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF'
    dataRow.eachCell((cell, ci) => {
      cell.font = { name: 'Aptos', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      cell.alignment = { horizontal: ci <= 4 ? 'left' : 'center', vertical: 'middle' }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      }
      // Highlight scheduled cells
      if (ci > 4 && cell.value !== '—') {
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1D4ED8' } }
      }
    })
  })

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `schedule-${weekLabel.replace(/[^a-zA-Z0-9-]/g, '_')}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// --- Print/PDF Export ---
function exportPrintPDF(rows: FlatRow[], dayCols: { key: string; label: string }[], weekLabel: string) {
  const pageSize = 30 // rows per page
  const pages = []
  for (let i = 0; i < rows.length; i += pageSize) {
    pages.push(rows.slice(i, i + pageSize))
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<title>Schedule — ${weekLabel}</title>
<style>
  @page { size: landscape; margin: 0.5in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  h1 { font-size: 16px; color: #1F3864; margin-bottom: 4px; }
  .subtitle { font-size: 11px; color: #64748b; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 9px; }
  th { background: #1F3864; color: #fff; padding: 6px 4px; text-align: center; font-weight: 600; }
  th:first-child { text-align: left; min-width: 140px; }
  td { padding: 4px; border-bottom: 1px solid #e2e8f0; text-align: center; }
  td:first-child { text-align: left; font-weight: 500; }
  tr:nth-child(even) td { background: #f8fafc; }
  .scheduled { color: #1d4ed8; font-weight: 500; }
  .dash { color: #cbd5e1; }
  .footer { font-size: 9px; color: #94a3b8; margin-top: 8px; text-align: right; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
${pages.map((page, pi) => `
<div class="page">
  <h1>📅 Employee Schedule</h1>
  <div class="subtitle">${weekLabel} — Page ${pi + 1} of ${pages.length} — Generated ${new Date().toLocaleDateString()}</div>
  <table>
    <thead>
      <tr>
        <th>Employee</th>
        <th>ID</th>
        <th>Dept</th>
        ${dayCols.map((d) => `<th>${d.label}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${page.map((row) => `
      <tr>
        <td>${row.employee}</td>
        <td>${row.employee_id}</td>
        <td>${row.department}</td>
        ${dayCols.map((d) => {
          const val = row[d.key] || '—'
          const cls = val === '—' ? 'dash' : 'scheduled'
          return `<td class="${cls}">${val}</td>`
        }).join('')}
      </tr>`).join('')}
    </tbody>
  </table>
  <div class="footer">Entech Operations Dashboard — ${weekLabel}</div>
</div>`).join('')}
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  // Auto-trigger print dialog after load
  win.onload = () => win.print()
}

export function ScheduleExport({ entries, employees, weekDates, weekLabel }: ScheduleExportProps) {
  const { language } = useI18n()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const updatePos = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, left: rect.right })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || dropRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const { rows, dayCols } = buildRows(entries, employees, weekDates, language)

  const handleExport = (type: 'csv' | 'excel' | 'pdf') => {
    setOpen(false)
    if (type === 'csv') exportCSV(rows, dayCols, weekLabel)
    else if (type === 'excel') exportExcel(rows, dayCols, weekLabel)
    else exportPrintPDF(rows, dayCols, weekLabel)
  }

  return (
    <>
      <Button
        ref={btnRef}
        variant="outline"
        size="sm"
        onClick={() => { updatePos(); setOpen(!open) }}
        className="border-border text-foreground/80 hover:bg-accent"
      >
        <Download className="size-4 mr-1" />
        <span className="hidden sm:inline">Export</span>
      </Button>

      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropRef}
          className="fixed z-50 bg-background border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
        >
          <button
            onClick={() => handleExport('csv')}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <FileText className="size-4 text-muted-foreground" />
            Export CSV
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <FileSpreadsheet className="size-4 text-emerald-500" />
            Export Excel
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <Printer className="size-4 text-blue-500" />
            Print / PDF
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
