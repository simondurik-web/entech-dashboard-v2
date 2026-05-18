'use client'

import { useCallback, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Loader2, AlertCircle } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

export type PhilReportColumn = {
  key: string
  label: string
  width?: number
  format?: 'text' | 'number' | 'currency' | 'date'
}

export type PhilReportSheet = {
  name: string
  columns: PhilReportColumn[]
  rows: Array<Record<string, unknown>>
}

export type PhilReport = {
  type: 'excel' | 'pdf'
  filename: string
  title?: string
  subtitle?: string
  sheets: PhilReportSheet[]
}

interface Props {
  report: PhilReport
}

export function isPhilReport(value: unknown): value is PhilReport {
  if (!value || typeof value !== 'object') return false
  const r = value as Partial<PhilReport>
  return (
    (r.type === 'excel' || r.type === 'pdf') &&
    typeof r.filename === 'string' &&
    Array.isArray(r.sheets) &&
    r.sheets.length > 0
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatCellForExcel(val: unknown, format?: PhilReportColumn['format']): unknown {
  if (val === null || val === undefined) return ''
  if (format === 'number' || format === 'currency') {
    if (typeof val === 'number') return val
    const n = Number(val)
    return Number.isFinite(n) ? n : val
  }
  if (format === 'date') {
    if (val instanceof Date) return val
    const d = new Date(String(val))
    return Number.isNaN(d.getTime()) ? String(val) : d
  }
  return typeof val === 'string' || typeof val === 'number' ? val : String(val)
}

async function buildExcel(report: PhilReport): Promise<Blob> {
  const ExcelJS = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Phil Assistant'
  wb.created = new Date()

  for (const sheet of report.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || 'Sheet')
    ws.columns = sheet.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: c.width ?? 16,
    }))

    const headerRow = ws.getRow(1)
    headerRow.height = 26
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

    sheet.rows.forEach((row, ri) => {
      const values: Record<string, unknown> = {}
      for (const col of sheet.columns) {
        values[col.key] = formatCellForExcel(row[col.key], col.format)
      }
      const dataRow = ws.addRow(values)
      dataRow.height = 20
      const bg = ri % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF'
      dataRow.eachCell((cell, colNumber) => {
        cell.font = { name: 'Aptos', size: 10, color: { argb: 'FF2D2D2D' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD6DCE4' } },
          bottom: { style: 'thin', color: { argb: 'FFD6DCE4' } },
          left: { style: 'thin', color: { argb: 'FFD6DCE4' } },
          right: { style: 'thin', color: { argb: 'FFD6DCE4' } },
        }
        const col = sheet.columns[colNumber - 1]
        if (typeof cell.value === 'number') {
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          if (col?.format === 'currency') cell.numFmt = '$#,##0.00'
          else if (col?.format === 'number') cell.numFmt = '#,##0'
        } else if (col?.format === 'date' && cell.value instanceof Date) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' }
          cell.numFmt = 'yyyy-mm-dd'
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' }
        }
      })
    })

    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    }
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

async function buildPdf(report: PhilReport): Promise<Blob> {
  const reactPdf = await import('@react-pdf/renderer')
  const React = await import('react')
  const { Document, Page, Text, View, StyleSheet, pdf } = reactPdf

  const styles = StyleSheet.create({
    page: { padding: 28, fontSize: 10, fontFamily: 'Helvetica' },
    title: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
    subtitle: { fontSize: 10, color: '#555', marginBottom: 12 },
    sheetName: { fontSize: 12, fontWeight: 'bold', marginTop: 12, marginBottom: 6 },
    table: { display: 'flex', flexDirection: 'column', borderTop: '1px solid #999', borderLeft: '1px solid #999' },
    headerRow: { flexDirection: 'row', backgroundColor: '#1F3864' },
    headerCell: {
      padding: 4,
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 9,
      borderRight: '1px solid #ccc',
      borderBottom: '1px solid #999',
    },
    row: { flexDirection: 'row' },
    rowAlt: { flexDirection: 'row', backgroundColor: '#F2F6FC' },
    cell: {
      padding: 4,
      fontSize: 9,
      borderRight: '1px solid #ccc',
      borderBottom: '1px solid #ccc',
    },
    cellNumber: {
      padding: 4,
      fontSize: 9,
      textAlign: 'right',
      borderRight: '1px solid #ccc',
      borderBottom: '1px solid #ccc',
    },
    footer: { position: 'absolute', bottom: 16, left: 28, right: 28, fontSize: 8, color: '#888', textAlign: 'center' },
  })

  const fmtCell = (val: unknown, format?: PhilReportColumn['format']): string => {
    if (val === null || val === undefined) return ''
    if (format === 'currency') {
      const n = typeof val === 'number' ? val : Number(val)
      if (!Number.isFinite(n)) return String(val)
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    }
    if (format === 'number') {
      const n = typeof val === 'number' ? val : Number(val)
      if (!Number.isFinite(n)) return String(val)
      return n.toLocaleString('en-US')
    }
    if (format === 'date') {
      const d = val instanceof Date ? val : new Date(String(val))
      if (Number.isNaN(d.getTime())) return String(val)
      return d.toISOString().slice(0, 10)
    }
    return String(val)
  }

  const sheetEls = report.sheets.map((sheet, si) => {
    const totalWidth = sheet.columns.reduce((sum, c) => sum + (c.width ?? 16), 0)
    const headerCells = sheet.columns.map((c, ci) =>
      React.createElement(
        Text,
        {
          key: `h-${ci}`,
          style: [styles.headerCell, { width: `${((c.width ?? 16) / totalWidth) * 100}%` }],
        },
        c.label,
      ),
    )
    const headerRow = React.createElement(View, { style: styles.headerRow }, headerCells)
    const dataRows = sheet.rows.map((row, ri) => {
      const cellEls = sheet.columns.map((c, ci) => {
        const isNum = c.format === 'number' || c.format === 'currency'
        return React.createElement(
          Text,
          {
            key: `c-${ri}-${ci}`,
            style: [
              isNum ? styles.cellNumber : styles.cell,
              { width: `${((c.width ?? 16) / totalWidth) * 100}%` },
            ],
          },
          fmtCell(row[c.key], c.format),
        )
      })
      return React.createElement(
        View,
        { key: `r-${ri}`, style: ri % 2 === 0 ? styles.row : styles.rowAlt },
        cellEls,
      )
    })
    // Allow @react-pdf to wrap the sheet across pages — `wrap: false` would
    // clip any report taller than one page (~50 rows at 9pt landscape).
    return React.createElement(
      View,
      { key: `s-${si}` },
      React.createElement(Text, { style: styles.sheetName }, sheet.name),
      React.createElement(View, { style: styles.table }, headerRow, ...dataRows),
    )
  })

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'LETTER', style: styles.page, orientation: 'landscape' },
      React.createElement(Text, { style: styles.title }, report.title ?? 'Phil Report'),
      report.subtitle ? React.createElement(Text, { style: styles.subtitle }, report.subtitle) : null,
      ...sheetEls,
      React.createElement(
        Text,
        { style: styles.footer, render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
            `Phil Assistant — ${pageNumber} / ${totalPages}` },
      ),
    ),
  )

  return await pdf(doc).toBlob()
}

export function PhilReportDownload({ report }: Props) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDownload = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = report.type === 'excel' ? await buildExcel(report) : await buildPdf(report)
      downloadBlob(blob, report.filename)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build report')
    } finally {
      setBusy(false)
    }
  }, [report])

  if (!isPhilReport(report)) return null

  const Icon = report.type === 'excel' ? FileSpreadsheet : FileText
  const label = report.type === 'excel' ? t('phil.report.downloadExcel') : t('phil.report.downloadPdf')

  return (
    <div className="mt-2 inline-flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onDownload}
        disabled={busy}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
        <span>{busy ? t('phil.report.generating') : label}</span>
        {!busy && <Download className="size-3" />}
      </Button>
      {error && (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3" />
          {error}
        </span>
      )}
    </div>
  )
}
