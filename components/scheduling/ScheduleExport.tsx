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
  shift_num: number
  [key: string]: string | number
}

const LABELS = {
  en: {
    employee: 'Employee',
    id: 'ID',
    department: 'Department',
    shift: 'Shift',
    shift1: 'Day Shift',
    shift2: 'Night Shift',
    title: 'Employee Schedule',
    page: 'Page',
    of: 'of',
    generated: 'Generated',
    footer: 'Entech Operations Dashboard',
    exportCSV: 'Export CSV',
    exportExcel: 'Export Excel',
    printPDF: 'Print / PDF',
    export: 'Export',
  },
  es: {
    employee: 'Empleado',
    id: 'ID',
    department: 'Departamento',
    shift: 'Turno',
    shift1: 'Turno de Día',
    shift2: 'Turno de Noche',
    title: 'Horario de Empleados',
    page: 'Página',
    of: 'de',
    generated: 'Generado',
    footer: 'Tablero de Operaciones Entech',
    exportCSV: 'Exportar CSV',
    exportExcel: 'Exportar Excel',
    printPDF: 'Imprimir / PDF',
    export: 'Exportar',
  },
}

/** Reorder weekDates so Monday is first */
function mondayFirst(weekDates: Date[]): Date[] {
  // weekDates may start on any day; sort by day-of-week with Mon=0
  const sorted = [...weekDates].sort((a, b) => {
    const da = (a.getDay() + 6) % 7 // Mon=0, Tue=1, ..., Sun=6
    const db = (b.getDay() + 6) % 7
    return da - db
  })
  return sorted
}

function buildRows(
  entries: ScheduleEntry[],
  employees: ScheduleEmployee[],
  weekDates: Date[],
  language: string
): { rows: FlatRow[]; dayCols: { key: string; label: string; date: Date }[] } {
  const locale = language === 'es' ? 'es-US' : 'en-US'
  const ordered = mondayFirst(weekDates)

  // Day columns — Monday first
  const dayCols = ordered.map((d) => {
    const dayName = d.toLocaleDateString(locale, { weekday: 'short' })
    const dateStr = d.toISOString().split('T')[0]
    const label = `${dayName} ${d.getMonth() + 1}/${d.getDate()}`
    return { key: dateStr, label, date: d }
  })

  // Entry lookup
  const entryMap = new Map<string, ScheduleEntry>()
  for (const e of entries) {
    entryMap.set(`${e.employee_id}::${e.date}`, e)
  }

  const l = LABELS[language as 'en' | 'es'] || LABELS.en

  // Build rows — sorted by shift (1 first), then last name
  const rows: FlatRow[] = employees
    .filter((e) => e.is_active !== false)
    .sort((a, b) => {
      if (a.default_shift !== b.default_shift) return a.default_shift - b.default_shift
      return a.last_name.localeCompare(b.last_name)
    })
    .map((emp) => {
      const row: FlatRow = {
        employee: `${emp.last_name}, ${emp.first_name}`,
        employee_id: emp.employee_id,
        department: emp.department,
        shift: emp.default_shift === 1 ? l.shift1 : l.shift2,
        shift_num: emp.default_shift,
      }
      for (const col of dayCols) {
        const entry = entryMap.get(`${emp.employee_id}::${col.key}`)
        if (entry) {
          const start = formatTimeShort(entry.start_time)
          const end = formatTimeShort(entry.end_time)
          const machine = entry.machine_name ? ` (${entry.machine_name})` : ''
          row[col.key] = `${start}-${end}${machine}`
        } else {
          row[col.key] = '-'
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
function exportCSV(rows: FlatRow[], dayCols: { key: string; label: string }[], weekLabel: string, language: string) {
  const l = LABELS[language as 'en' | 'es'] || LABELS.en
  const cols = [
    { key: 'employee', label: l.employee },
    { key: 'employee_id', label: l.id },
    { key: 'department', label: l.department },
    { key: 'shift', label: l.shift },
    ...dayCols.map((d) => ({ key: d.key, label: d.label })),
  ]
  const esc = (s: string) => {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const header = cols.map((c) => esc(c.label)).join(',')
  const lines = rows.map((r) => cols.map((c) => esc(String(r[c.key] || '-'))).join(','))
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
async function exportExcel(rows: FlatRow[], dayCols: { key: string; label: string }[], weekLabel: string, language: string) {
  const ExcelJS = await import('exceljs')
  const l = LABELS[language as 'en' | 'es'] || LABELS.en
  const wb = new ExcelJS.Workbook()

  // Split by shift
  const shift1Rows = rows.filter((r) => r.shift_num === 1)
  const shift2Rows = rows.filter((r) => r.shift_num === 2)

  const sheetGroups = [
    { label: l.shift1, rows: shift1Rows },
    { label: l.shift2, rows: shift2Rows },
  ].filter((g) => g.rows.length > 0)

  for (const group of sheetGroups) {
    const ws = wb.addWorksheet(group.label)
    const cols = [
      { key: 'employee', label: l.employee, width: 25 },
      { key: 'employee_id', label: l.id, width: 8 },
      { key: 'department', label: l.department, width: 15 },
      { key: 'shift', label: l.shift, width: 14 },
      ...dayCols.map((d) => ({ key: d.key, label: d.label, width: 18 })),
    ]

    // Title row
    ws.mergeCells(1, 1, 1, cols.length)
    const titleCell = ws.getCell(1, 1)
    titleCell.value = `${l.title} - ${group.label} - ${weekLabel}`
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
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0D1B3E' } } }
    })

    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

    group.rows.forEach((row, ri) => {
      const values = cols.map((c) => row[c.key] || '-')
      const dataRow = ws.addRow(values)
      dataRow.height = 22
      const bg = ri % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF'
      dataRow.eachCell((cell, ci) => {
        cell.font = { name: 'Aptos', size: 10 }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.alignment = { horizontal: ci <= 4 ? 'left' : 'center', vertical: 'middle' }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } }
        if (ci > 4 && cell.value !== '-') {
          cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF1D4ED8' } }
        }
      })
    })
  }

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
function exportPrintPDF(rows: FlatRow[], dayCols: { key: string; label: string }[], weekLabel: string, language: string) {
  const l = LABELS[language as 'en' | 'es'] || LABELS.en
  const pageSize = 28

  // Split by shift
  const shift1Rows = rows.filter((r) => r.shift_num === 1)
  const shift2Rows = rows.filter((r) => r.shift_num === 2)

  const shiftGroups = [
    { label: l.shift1, rows: shift1Rows, badge: 'day', icon: '&#9728;' },
    { label: l.shift2, rows: shift2Rows, badge: 'night', icon: '&#9790;' },
  ].filter((g) => g.rows.length > 0)

  // Build pages
  const allPages: { shiftLabel: string; badge: string; icon: string; pageRows: FlatRow[]; pageNum: number; totalPages: number }[] = []
  for (const group of shiftGroups) {
    const groupPages: FlatRow[][] = []
    for (let i = 0; i < group.rows.length; i += pageSize) {
      groupPages.push(group.rows.slice(i, i + pageSize))
    }
    groupPages.forEach((page, pi) => {
      allPages.push({
        shiftLabel: group.label,
        badge: group.badge,
        icon: group.icon,
        pageRows: page,
        pageNum: pi + 1,
        totalPages: groupPages.length,
      })
    })
  }

  // Day column headers with split name/date
  const thDays = dayCols.map((d) => {
    const parts = d.label.split(' ')
    return `<th class="day-col"><div class="day-name">${parts[0]}</div><div class="day-date">${parts[1] || ''}</div></th>`
  }).join('')

  const genDate = new Date().toLocaleDateString(language === 'es' ? 'es-US' : 'en-US')

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${l.title} - ${weekLabel}</title>
<style>
  @page { size: landscape; margin: 0.4in 0.5in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { page-break-after: always; } .page:last-child { page-break-after: avoid; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 3px solid #1e3a5f; }
  .header-left { display: flex; align-items: baseline; gap: 14px; }
  .logo { font-size: 24px; font-weight: 800; color: #1e3a5f; letter-spacing: 3px; }
  .title { font-size: 16px; font-weight: 600; color: #475569; }
  .header-right { text-align: right; }
  .week-range { font-size: 11px; color: #64748b; margin-top: 5px; }
  .shift-badge { display: inline-block; padding: 5px 16px; border-radius: 8px; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; }
  .shift-badge.day { background: #1e3a5f; color: #ffffff; }
  .shift-badge.night { background: #312e81; color: #ffffff; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 8.5px; border-radius: 8px; overflow: hidden; border: 1.5px solid #cbd5e1; }
  thead th { background: #1e3a5f; color: #ffffff; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 5px; text-align: center; border-right: 1px solid rgba(255,255,255,0.15); }
  thead th:last-child { border-right: none; }
  thead th.emp-col { text-align: left; padding-left: 12px; min-width: 160px; }
  thead th.id-col { min-width: 44px; }
  thead .day-name { font-size: 9px; font-weight: 700; }
  thead .day-date { font-size: 8px; font-weight: 400; opacity: 0.8; margin-top: 2px; }
  tbody td { padding: 6px 4px; text-align: center; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; vertical-align: middle; }
  tbody td:last-child { border-right: none; }
  tbody tr:last-child td { border-bottom: none; }
  tr.even td { background: #ffffff; } tr.odd td { background: #f1f5f9; }
  td.emp-name { text-align: left; padding-left: 12px; font-weight: 600; color: #1e293b; white-space: nowrap; font-size: 9px; }
  td.emp-id { text-align: center; color: #64748b; font-size: 8.5px; font-weight: 500; }
  td.empty { color: #cbd5e1; } td.empty::after { content: '\\2014'; }
  td.has-shift { background: #eff6ff !important; }
  td.has-shift .time { color: #1e40af; font-weight: 700; font-size: 8.5px; white-space: nowrap; }
  td.has-shift .machine { color: #6b7280; font-size: 7px; margin-top: 2px; font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100px; }
  .footer { display: flex; justify-content: space-between; margin-top: 10px; font-size: 8px; color: #9ca3af; padding-top: 6px; border-top: 1px solid #e5e7eb; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
${allPages.map((p) => `
<div class="page">
  <div class="header">
    <div class="header-left">
      <div class="logo">ENTECH</div>
      <div class="title">${l.title}</div>
    </div>
    <div class="header-right">
      <div class="shift-badge ${p.badge}">${p.icon} ${p.shiftLabel}</div>
      <div class="week-range">${weekLabel}</div>
    </div>
  </div>
  <table>
    <thead><tr><th class="emp-col">${l.employee}</th><th class="id-col">${l.id}</th>${thDays}</tr></thead>
    <tbody>
      ${p.pageRows.map((row, ri) => {
        const cls = ri % 2 === 0 ? 'even' : 'odd'
        const cells = dayCols.map((d) => {
          const val = String(row[d.key] || '-')
          if (val === '-') return '<td class="empty"></td>'
          const parts = val.split(' (')
          const time = parts[0]
          const machine = parts.length > 1 ? '<div class="machine">' + parts[1].replace(')', '') + '</div>' : ''
          return '<td class="has-shift"><div class="time">' + time + '</div>' + machine + '</td>'
        }).join('')
        return '<tr class="' + cls + '"><td class="emp-name">' + row.employee + '</td><td class="emp-id">' + row.employee_id + '</td>' + cells + '</tr>'
      }).join('')}
    </tbody>
  </table>
  <div class="footer">
    <span>${l.footer}</span>
    <span>${l.page} ${p.pageNum} ${l.of} ${p.totalPages} &bull; ${p.shiftLabel} &bull; ${l.generated} ${genDate}</span>
  </div>
</div>`).join('')}
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.onload = () => win.print()
}

export function ScheduleExport({ entries, employees, weekDates, weekLabel }: ScheduleExportProps) {
  const { language } = useI18n()
  const l = LABELS[language as 'en' | 'es'] || LABELS.en
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

  // employees prop already comes filtered from the page (by dept, shift, search)
  const { rows, dayCols } = buildRows(entries, employees, weekDates, language)

  const handleExport = (type: 'csv' | 'excel' | 'pdf') => {
    setOpen(false)
    if (type === 'csv') exportCSV(rows, dayCols, weekLabel, language)
    else if (type === 'excel') exportExcel(rows, dayCols, weekLabel, language)
    else exportPrintPDF(rows, dayCols, weekLabel, language)
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
        <span className="hidden sm:inline">{l.export}</span>
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
            {l.exportCSV}
          </button>
          <button
            onClick={() => handleExport('excel')}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <FileSpreadsheet className="size-4 text-emerald-500" />
            {l.exportExcel}
          </button>
          <button
            onClick={() => handleExport('pdf')}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
          >
            <Printer className="size-4 text-blue-500" />
            {l.printPDF}
          </button>
        </div>,
        document.body
      )}
    </>
  )
}
