import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import React from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/types'
import { requirePermissionOrDevice } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { applyShipmentFilters, normalizeShipmentRow, parseShipmentFilters, SHIPMENT_COLUMNS, type ShipmentFilters } from '@/lib/shipments/query'
import type { ShipmentRow } from '@/lib/shipments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const XLSX_CAP = 50_000
const PDF_CAP = 2_000
const PAGE_SIZE = 1000

const pdfStyles = StyleSheet.create({
  page: {
    paddingHorizontal: 16,
    paddingTop: 34,
    paddingBottom: 24,
    fontFamily: 'Helvetica',
    fontSize: 5,
    color: '#222',
  },
  title: {
    position: 'absolute',
    top: 10,
    left: 16,
    fontSize: 10,
    fontWeight: 'bold',
  },
  warning: {
    marginBottom: 5,
    padding: 4,
    backgroundColor: '#fff4ce',
    border: '1px solid #d69e00',
    fontSize: 6,
    fontWeight: 'bold',
  },
  header: {
    flexDirection: 'row',
    borderBottom: '1px solid #777',
    paddingBottom: 2,
    marginBottom: 1,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    borderBottom: '0.5px solid #ddd',
    paddingVertical: 2,
  },
  date: { width: '10%' },
  po: { width: '8%' },
  partner: { width: '8%' },
  part: { width: '10%' },
  qty: { width: '4%', textAlign: 'right', paddingRight: 2 },
  recipient: { width: '12%' },
  destination: { width: '13%' },
  service: { width: '12%' },
  residential: { width: '6%' },
  source: { width: '10%' },
  tracking: { width: '7%' },
  footer: {
    position: 'absolute',
    bottom: 8,
    left: 16,
    right: 16,
    textAlign: 'center',
    color: '#666',
  },
})

function formatEtTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function destination(row: ShipmentRow): string {
  return [row.city, row.state, row.zip].filter(Boolean).join(', ')
}

function pdfCell(text: string, style: Style | Style[], key?: string) {
  return React.createElement(Text, { style, key }, text)
}

function pdfRow(row: ShipmentRow) {
  return React.createElement(
    View,
    { key: row.id, style: pdfStyles.row, wrap: false },
    pdfCell(formatEtTimestamp(row.sent_at), pdfStyles.date),
    pdfCell(row.po_number ?? '', pdfStyles.po),
    pdfCell(row.partner ?? '', pdfStyles.partner),
    pdfCell(row.part_number ?? '', pdfStyles.part),
    pdfCell(String(row.qty), pdfStyles.qty),
    pdfCell(row.ship_to_name ?? '', pdfStyles.recipient),
    pdfCell(destination(row), pdfStyles.destination),
    pdfCell(row.service ?? '', pdfStyles.service),
    pdfCell(row.residential === null ? '' : row.residential ? 'Yes' : 'No', pdfStyles.residential),
    pdfCell(row.source_system ?? '', pdfStyles.source),
    pdfCell(row.tracking ?? '', pdfStyles.tracking)
  )
}

function shipmentPdf(rows: ShipmentRow[], warning: string | null) {
  const header = React.createElement(
    View,
    { style: pdfStyles.header, fixed: true },
    pdfCell('Sent (ET)', pdfStyles.date),
    pdfCell('PO', pdfStyles.po),
    pdfCell('Partner', pdfStyles.partner),
    pdfCell('Part', pdfStyles.part),
    pdfCell('Qty', pdfStyles.qty),
    pdfCell('Recipient', pdfStyles.recipient),
    pdfCell('Destination', pdfStyles.destination),
    pdfCell('Service', pdfStyles.service),
    pdfCell('Res.', pdfStyles.residential),
    pdfCell('Source', pdfStyles.source),
    pdfCell('Tracking', pdfStyles.tracking)
  )

  return React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: 'LETTER', orientation: 'landscape', style: pdfStyles.page, wrap: true },
      React.createElement(Text, { style: pdfStyles.title, fixed: true }, 'Shipments'),
      warning ? React.createElement(Text, { style: pdfStyles.warning }, warning) : null,
      header,
      ...rows.map(pdfRow),
      React.createElement(Text, {
        style: pdfStyles.footer,
        fixed: true,
        render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `${pageNumber} / ${totalPages}`,
      })
    )
  )
}

async function fetchRows(filters: ShipmentFilters, cap: number): Promise<{ rows: ShipmentRow[]; truncated: boolean }> {
  const rows: ShipmentRow[] = []
  let offset = 0

  while (rows.length <= cap) {
    const query = applyShipmentFilters(
      supabaseAdmin.from('shipment_history').select(SHIPMENT_COLUMNS),
      filters
    )

    const upper = Math.min(offset + PAGE_SIZE - 1, cap)
    const { data, error } = await query
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, upper)

    if (error) throw new Error(`Supabase shipment export error: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data.map((row) => normalizeShipmentRow(row as Record<string, unknown>)))
    if (data.length < upper - offset + 1) break
    offset = upper + 1
  }

  return {
    rows: rows.slice(0, cap),
    truncated: rows.length > cap,
  }
}

async function xlsxResponse(rows: ShipmentRow[], truncated: boolean, filename: string) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Shipments')
  worksheet.columns = [
    { header: 'Sent (ET)', key: 'sentAt', width: 20 },
    { header: 'PO number', key: 'poNumber', width: 16 },
    { header: 'Partner', key: 'partner', width: 20 },
    { header: 'Part number', key: 'partNumber', width: 20 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Recipient', key: 'recipient', width: 28 },
    { header: 'Destination', key: 'destination', width: 24 },
    { header: 'Service', key: 'service', width: 24 },
    { header: 'Residential', key: 'residential', width: 14 },
    { header: 'Source system', key: 'source', width: 26 },
    { header: 'Tracking', key: 'tracking', width: 24 },
  ]

  const warning = truncated ? `Truncated to ${XLSX_CAP} rows — narrow your filters` : null
  if (warning) {
    worksheet.insertRow(1, [warning])
    worksheet.mergeCells(1, 1, 1, worksheet.columns.length)
    const warningCell = worksheet.getCell(1, 1)
    warningCell.font = { bold: true, color: { argb: 'FF7A4E00' } }
    warningCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CE' } }
  }

  const headerRow = worksheet.getRow(warning ? 2 : 1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF333333' } }

  for (const row of rows) {
    worksheet.addRow({
      sentAt: formatEtTimestamp(row.sent_at),
      poNumber: row.po_number ?? '',
      partner: row.partner ?? '',
      partNumber: row.part_number ?? '',
      qty: row.qty,
      recipient: row.ship_to_name ?? '',
      destination: destination(row),
      service: row.service ?? '',
      residential: row.residential === null ? '' : row.residential ? 'Yes' : 'No',
      source: row.source_system ?? '',
      tracking: row.tracking ?? '',
    })
  }
  worksheet.views = [{ state: 'frozen', ySplit: warning ? 2 : 1 }]
  worksheet.autoFilter = {
    from: { row: warning ? 2 : 1, column: 1 },
    to: { row: warning ? 2 : 1, column: worksheet.columns.length },
  }

  const bytes = await workbook.xlsx.writeBuffer()
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}

async function pdfResponse(rows: ShipmentRow[], truncated: boolean, filename: string) {
  const warning = truncated ? `Truncated to ${PDF_CAP} rows — narrow your filters` : null
  // Match the repository's @react-pdf route pattern; renderer types do not accept
  // React's inferred createElement tree even though the runtime does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bytes = await renderToBuffer(shipmentPdf(rows, warning) as any)
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(req: NextRequest) {
  if (!(await requirePermissionOrDevice(req, '/shipments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const format = req.nextUrl.searchParams.get('format')
  const filters = parseShipmentFilters(req.nextUrl.searchParams)
  if ((format !== 'xlsx' && format !== 'pdf') || !filters) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  try {
    const cap = format === 'xlsx' ? XLSX_CAP : PDF_CAP
    const result = await fetchRows(filters, cap)
    const filename = `shipments-${filters.from ?? 'all'}-${filters.to ?? 'all'}`
    return format === 'xlsx'
      ? xlsxResponse(result.rows, result.truncated, filename)
      : pdfResponse(result.rows, result.truncated, filename)
  } catch (error) {
    console.error('shipments export failed:', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 502 })
  }
}
