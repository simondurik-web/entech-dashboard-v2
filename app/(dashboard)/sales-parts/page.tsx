'use client'

import { useEffect, useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Download, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'

interface SalesOrder {
  line: string
  customer: string
  partNumber: string
  category: string
  qty: number
  revenue: number
  variableCost: number
  totalCost: number
  pl: number
  shippedDate: string
  status: string
}

interface SalesData {
  orders: SalesOrder[]
  summary: { totalRevenue: number; totalCosts: number; totalPL: number; avgMargin: number; orderCount: number }
}

interface PartRow extends Record<string, unknown> {
  partNumber: string
  category: string
  orderCount: number
  totalQty: number
  revenue: number
  costs: number
  pl: number
  margin: number
  orders: SalesOrder[]
}

function fmt(v: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v) }
function fmtN(v: number) { return new Intl.NumberFormat('en-US').format(Math.round(v)) }

const CAT_CLS: Record<string, string> = {
  'Roll Tech': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  'Molding': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
  'Snap Pad': 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  'Other': 'bg-gray-500/20 text-gray-400 border-gray-500/50',
}

// ── Export helpers ──────────────────────────────────────
const EXP_COLS = [
  { key: 'line', label: 'Line' }, { key: 'customer', label: 'Customer' },
  { key: 'qty', label: 'Qty' }, { key: 'revenue', label: 'Revenue' },
  { key: 'totalCost', label: 'Total Cost' }, { key: 'pl', label: 'P/L' },
  { key: 'shippedDate', label: 'Shipped' }, { key: 'status', label: 'Status' },
]

function toExportRows(orders: SalesOrder[]) {
  return orders.map(o => ({
    line: o.line, customer: o.customer, qty: o.qty, revenue: o.revenue,
    totalCost: o.totalCost || o.variableCost, pl: o.pl, shippedDate: o.shippedDate, status: o.status,
  }))
}

function downloadCSV(rows: Record<string, unknown>[], cols: { key: string; label: string }[], filename: string) {
  const hdr = cols.map(c => c.label).join(',')
  const body = rows.map(r => cols.map(c => {
    const v = r[c.key]; const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([hdr + '\n' + body], { type: 'text/csv' }))
  a.download = `${filename}.csv`; a.click()
}

// Currency columns for Excel formatting
const CURRENCY_KEYS = new Set(['revenue', 'totalCost', 'costs', 'variableCost', 'pl', 'Total Cost', 'Revenue', 'P/L'])
const NUMBER_KEYS = new Set(['qty', 'totalQty', 'orderCount', 'Qty', 'Orders'])

async function downloadExcel(rows: Record<string, unknown>[], cols: { key: string; label: string }[], filename: string) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Data')
  const hr = ws.addRow(cols.map(c => c.label)); hr.height = 28
  hr.eachCell(cell => {
    cell.font = { name: 'Aptos', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  })
  rows.forEach((r, i) => {
    const row = ws.addRow(cols.map(c => { const v = r[c.key]; return typeof v === 'number' ? v : v ?? '' }))
    row.height = 22; const bg = i % 2 === 0 ? 'FFF2F6FC' : 'FFFFFFFF'
    row.eachCell((cell, colNum) => {
      cell.font = { name: 'Aptos', size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
      // Apply number formatting
      const colKey = cols[colNum - 1]?.key || ''
      const colLabel = cols[colNum - 1]?.label || ''
      if (CURRENCY_KEYS.has(colKey) || CURRENCY_KEYS.has(colLabel)) {
        cell.numFmt = '$#,##0.00'
      } else if (NUMBER_KEYS.has(colKey) || NUMBER_KEYS.has(colLabel)) {
        cell.numFmt = '#,##0'
      }
    })
  })
  ws.columns.forEach(col => { col.width = 18 })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + cols.length)}1` }
  const buf = await wb.xlsx.writeBuffer()
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  a.download = `${filename}.xlsx`; a.click()
}

function ExportBtns({ rows, cols, filename }: { rows: Record<string, unknown>[]; cols: { key: string; label: string }[]; filename: string }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => downloadCSV(rows, cols, filename)} className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 flex items-center gap-1"><Download className="h-3 w-3" /> CSV</button>
      <button onClick={() => downloadExcel(rows, cols, filename)} className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/80 flex items-center gap-1"><Download className="h-3 w-3" /> Excel</button>
    </div>
  )
}

// ── Sortable sub-table (lightweight, not full DataTable) ──
type SortDir = 'asc' | 'desc' | null
function useSortable<T>(data: T[], defaultKey?: keyof T & string) {
  const [sortKey, setSortKey] = useState<string | null>(defaultKey ?? null)
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const toggle = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return data
    return [...data].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey], bv = (b as Record<string, unknown>)[sortKey]
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])
  return { sorted, sortKey, sortDir, toggle }
}

function SortIcon({ col, sortKey, sortDir }: { col: string; sortKey: string | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 text-muted-foreground inline ml-0.5" />
  return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 inline ml-0.5" /> : <ArrowDown className="h-3 w-3 inline ml-0.5" />
}

// ── Order-level DataTable columns ──────────────────────
const ORDER_COLUMNS: ColumnDef<OrderRow>[] = [
  { key: 'line' as keyof OrderRow & string, label: 'Line', sortable: true, filterable: true },
  { key: 'customer' as keyof OrderRow & string, label: 'Customer', sortable: true, filterable: true },
  { key: 'qty' as keyof OrderRow & string, label: 'Qty', sortable: true, render: (v) => fmtN(v as number) },
  { key: 'revenue' as keyof OrderRow & string, label: 'Revenue', sortable: true, render: (v) => fmt(v as number) },
  { key: 'totalCost' as keyof OrderRow & string, label: 'Total Cost', sortable: true, render: (v) => fmt(v as number) },
  { key: 'pl' as keyof OrderRow & string, label: 'P/L', sortable: true, render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{fmt(v as number)}</span> },
  { key: 'shippedDate' as keyof OrderRow & string, label: 'Shipped', sortable: true, filterable: true },
  { key: 'status' as keyof OrderRow & string, label: 'Status', sortable: true, filterable: true },
]

interface OrderRow extends Record<string, unknown> {
  line: string; customer: string; qty: number; revenue: number; totalCost: number; pl: number; shippedDate: string; status: string
}

function OrdersDataTable({ orders, storageKey }: { orders: SalesOrder[]; storageKey: string }) {
  const rows: OrderRow[] = useMemo(() => orders.map(o => ({
    line: o.line, customer: o.customer, qty: o.qty, revenue: o.revenue,
    totalCost: o.totalCost || o.variableCost, pl: o.pl, shippedDate: o.shippedDate, status: o.status,
  })), [orders])

  const table = useDataTable({ data: rows, columns: ORDER_COLUMNS, storageKey })

  return (
    <div className="max-h-[400px] overflow-y-auto">
      <DataTable table={table} data={rows} noun="order" exportFilename={storageKey} getRowKey={(r) => `${(r as OrderRow).line}`} />
    </div>
  )
}

// ── Customer sub-expand row (uses DataTable inside) ────
function CustomerExpandRow({ customer, orders, partNumber }: { customer: string; orders: SalesOrder[]; partNumber: string }) {
  const [expanded, setExpanded] = useState(false)
  const totalQty = orders.reduce((s, o) => s + o.qty, 0)
  const revenue = orders.reduce((s, o) => s + o.revenue, 0)
  const costs = orders.reduce((s, o) => s + (o.totalCost || o.variableCost), 0)
  const pl = orders.reduce((s, o) => s + o.pl, 0)
  const margin = revenue > 0 ? (pl / revenue) * 100 : 0

  return (
    <>
      <tr className="border-t border-border/30 hover:bg-muted/20 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <td className="px-2 py-1.5 text-xs">{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
        <td className="px-2 py-1.5 text-xs font-medium">{customer}</td>
        <td className="px-2 py-1.5 text-xs text-right">{orders.length}</td>
        <td className="px-2 py-1.5 text-xs text-right">{fmtN(totalQty)}</td>
        <td className="px-2 py-1.5 text-xs text-right">{fmt(revenue)}</td>
        <td className="px-2 py-1.5 text-xs text-right">{fmt(costs)}</td>
        <td className={`px-2 py-1.5 text-xs text-right font-semibold ${pl >= 0 ? 'text-green-500' : 'text-red-500'}`}>{fmt(pl)}</td>
        <td className={`px-2 py-1.5 text-xs text-right ${margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>{margin.toFixed(1)}%</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-muted/5 px-4 py-2">
            <OrdersDataTable orders={orders} storageKey={`${partNumber}_${customer.replace(/\W/g, '_')}_orders`} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Expanded section for a part ────────────────────────
function PartExpandedSection({ part }: { part: PartRow }) {
  const customerGroups = useMemo(() => {
    const grp: Record<string, SalesOrder[]> = {}
    for (const o of part.orders) { const k = o.customer || 'Unknown'; (grp[k] ??= []).push(o) }
    return Object.entries(grp).sort((a, b) => {
      const ra = a[1].reduce((s, o) => s + o.revenue, 0), rb = b[1].reduce((s, o) => s + o.revenue, 0)
      return rb - ra
    })
  }, [part.orders])

  const hasMultipleCustomers = customerGroups.length > 1

  // Single customer → show orders directly with full DataTable
  if (!hasMultipleCustomers) {
    return (
      <div className="px-4 py-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">
          {part.orders.length} orders for {customerGroups[0]?.[0] || 'Unknown'}
        </p>
        <OrdersDataTable orders={part.orders} storageKey={`${part.partNumber}_orders`} />
      </div>
    )
  }

  // Multiple customers → customer groups with sub-expand
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          {customerGroups.length} customers — {part.orders.length} total orders
        </p>
        <ExportBtns rows={toExportRows(part.orders)} cols={EXP_COLS} filename={`${part.partNumber}_all_orders`} />
      </div>
      <div className="max-h-[500px] overflow-y-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
            <tr className="text-muted-foreground">
              <th className="px-2 py-1.5 text-left w-6"></th>
              <th className="px-2 py-1.5 text-left">Customer</th>
              <th className="px-2 py-1.5 text-right">Orders</th>
              <th className="px-2 py-1.5 text-right">Qty</th>
              <th className="px-2 py-1.5 text-right">Revenue</th>
              <th className="px-2 py-1.5 text-right">Total Cost</th>
              <th className="px-2 py-1.5 text-right">P/L</th>
              <th className="px-2 py-1.5 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            {customerGroups.map(([customer, orders]) => (
              <CustomerExpandRow key={customer} customer={customer} orders={orders} partNumber={part.partNumber} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────
export default function SalesPartsPage() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedPart, setExpandedPart] = useState<string | null>(null)
  const { t } = useI18n()

  useEffect(() => {
    fetch('/api/sales').then(r => r.ok ? r.json() : Promise.reject('Failed'))
      .then(d => setData(d)).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [])

  const partSummaries: PartRow[] = useMemo(() => {
    if (!data) return []
    const byPart: Record<string, PartRow> = {}
    for (const o of data.orders) {
      const k = o.partNumber || 'Unknown'
      if (!byPart[k]) byPart[k] = { partNumber: k, category: o.category, orderCount: 0, totalQty: 0, revenue: 0, costs: 0, pl: 0, margin: 0, orders: [] }
      byPart[k].orderCount++
      byPart[k].totalQty += o.qty
      byPart[k].revenue += o.revenue
      byPart[k].costs += o.totalCost || o.variableCost
      byPart[k].pl += o.pl
      byPart[k].orders.push(o)
    }
    return Object.values(byPart).map(p => ({ ...p, margin: p.revenue > 0 ? (p.pl / p.revenue) * 100 : 0 }))
  }, [data])

  const PART_COLUMNS: ColumnDef<PartRow>[] = useMemo(() => [
    { key: 'partNumber' as keyof PartRow & string, label: t('table.partNumber'), sortable: true, filterable: true },
    { key: 'category' as keyof PartRow & string, label: t('table.category'), sortable: true, filterable: true,
      render: (v) => <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${CAT_CLS[v as string] || CAT_CLS['Other']}`}>{v as string}</span> },
    { key: 'orderCount' as keyof PartRow & string, label: t('table.orders'), sortable: true, render: (v) => fmtN(v as number) },
    { key: 'totalQty' as keyof PartRow & string, label: t('table.qty'), sortable: true, render: (v) => fmtN(v as number) },
    { key: 'revenue' as keyof PartRow & string, label: t('table.revenue'), sortable: true, render: (v) => fmt(v as number) },
    { key: 'costs' as keyof PartRow & string, label: t('salesOverview.totalCosts'), sortable: true, render: (v) => fmt(v as number) },
    { key: 'pl' as keyof PartRow & string, label: 'P/L', sortable: true,
      render: (v) => <span className={(v as number) >= 0 ? 'text-green-500 font-semibold' : 'text-red-500 font-semibold'}>{fmt(v as number)}</span> },
    { key: 'margin' as keyof PartRow & string, label: t('salesOverview.avgMargin'), sortable: true,
      render: (v) => <span className={(v as number) >= 0 ? 'text-green-500' : 'text-red-500'}>{(v as number).toFixed(1)}%</span> },
  ], [t])

  const table = useDataTable({ data: partSummaries, columns: PART_COLUMNS, storageKey: 'sales-by-part' })

  if (loading) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
    </div>
  )

  if (error || !data) return (
    <div className="p-6"><div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"><p className="text-destructive">{error || 'Failed'}</p></div></div>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t('page.salesByPart')}</h1>
        <p className="text-sm text-muted-foreground">{t('page.salesByPartSubtitle')}</p>
      </div>

      <DataTable
        table={table}
        data={partSummaries}
        noun="part"
        exportFilename="sales-by-part"
        getRowKey={(row) => (row as PartRow).partNumber}
        expandedRowKey={expandedPart}
        onRowClick={(row) => {
          const pn = (row as PartRow).partNumber
          setExpandedPart(prev => prev === pn ? null : pn)
        }}
        renderExpandedContent={(row) => <PartExpandedSection part={row as PartRow} />}
      />
    </div>
  )
}
