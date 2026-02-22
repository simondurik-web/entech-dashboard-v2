'use client'

import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { TableSkeleton } from "@/components/ui/skeleton-loader"
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { useViewFromUrl, useAutoExport } from '@/lib/use-view-from-url'

interface Quote {
  id: string
  quote_number: string
  customer: string
  created_date: string | null
  valid_until: string | null
  amount: number
  sales_rep: string | null
  quoted_items: number
  notes: string | null
  payment_terms: string | null
  extra_notes: string | null
  status: string
  pdf_url: string | null
  drive_link: string | null
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(v)
}

const STATUS_OPTIONS = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-zinc-700 text-zinc-300',
  sent: 'bg-blue-900/50 text-blue-400',
  accepted: 'bg-green-900/50 text-green-400',
  declined: 'bg-red-900/50 text-red-400',
  expired: 'bg-amber-900/50 text-amber-400',
}

function StatusDropdown({ value, quoteId, onUpdate }: { value: string; quoteId: string; onUpdate: (id: string, status: string) => void }) {
  return (
    <select
      value={value || 'draft'}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { e.stopPropagation(); onUpdate(quoteId, e.target.value) }}
      className={`px-2 py-0.5 rounded text-xs font-medium border-0 cursor-pointer appearance-none pr-5 ${STATUS_COLORS[value] || STATUS_COLORS.draft}`}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%23999' d='M0 2l4 4 4-4z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
    >
      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

function EditableNotes({ value, quoteId, onUpdate }: { value: string | null; quoteId: string; onUpdate: (id: string, notes: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setText(value || '') }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  if (!editing) {
    return (
      <span
        className="text-xs text-zinc-400 cursor-pointer hover:text-zinc-200 min-w-[60px] inline-block"
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        title="Click to edit"
      >
        {text || '—'}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { setEditing(false); if (text !== (value || '')) onUpdate(quoteId, text) }}
      onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(false); if (text !== (value || '')) onUpdate(quoteId, text) } if (e.key === 'Escape') { setEditing(false); setText(value || '') } }}
      className="bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-white w-full min-w-[120px]"
    />
  )
}

export default function QuotesPage() {
  return <Suspense><QuotesContent /></Suspense>
}

function QuotesContent() {
  const [data, setData] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewingPdf, setViewingPdf] = useState<{ url: string; quoteNumber: string } | null>(null)
  const [hoveredQuote, setHoveredQuote] = useState<string | null>(null)
  const { t } = useI18n()
  const initialView = useViewFromUrl()
  const autoExport = useAutoExport()

  useEffect(() => {
    fetch('/api/quotes')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch quotes')
        return res.json()
      })
      .then((quotes: Quote[]) => setData(quotes))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const updateQuote = useCallback(async (id: string, field: 'status' | 'notes', value: string) => {
    try {
      const res = await fetch('/api/quotes/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      })
      if (!res.ok) throw new Error('Update failed')
      setData((prev) => prev.map((q) => q.id === id ? { ...q, [field]: value } : q))
    } catch (err) {
      console.error('Failed to update quote:', err)
    }
  }, [])

  const handleStatusUpdate = useCallback((id: string, status: string) => {
    updateQuote(id, 'status', status)
  }, [updateQuote])

  const handleNotesUpdate = useCallback((id: string, notes: string) => {
    updateQuote(id, 'notes', notes)
  }, [updateQuote])

  const handleRowClick = useCallback((row: Quote) => {
    if (row.pdf_url) {
      setViewingPdf({ url: row.pdf_url, quoteNumber: row.quote_number })
    } else if (row.drive_link) {
      window.open(row.drive_link, '_blank')
    }
  }, [])

  const columns: ColumnDef<Quote>[] = [
    {
      key: 'quote_number',
      label: 'Quote #',
      sortable: true,
      filterable: true,
      render: (v, row) => (
        <span className="font-medium text-blue-400 cursor-pointer hover:underline">
          {String(v)}
          {row.pdf_url && <span className="ml-1 text-xs">📄</span>}
        </span>
      ),
    },
    { key: 'customer', label: 'Customer', sortable: true, filterable: true },
    {
      key: 'created_date',
      label: 'Created',
      sortable: true,
      render: (v) => <span>{formatDate(v as string | null)}</span>,
    },
    {
      key: 'valid_until',
      label: 'Valid Until',
      sortable: true,
      render: (v) => <span>{formatDate(v as string | null)}</span>,
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (v) => (
        <span className="font-mono text-green-400">{formatCurrency(v as number)}</span>
      ),
    },
    { key: 'sales_rep', label: 'Sales Rep', sortable: true, filterable: true },
    { key: 'quoted_items', label: 'Items', sortable: true },
    { key: 'payment_terms', label: 'Payment Terms', sortable: true, filterable: true },
    {
      key: 'notes',
      label: 'Comments',
      sortable: true,
      filterable: true,
      render: (v, row) => <EditableNotes value={v as string | null} quoteId={(row as unknown as Quote).id} onUpdate={handleNotesUpdate} />,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      filterable: true,
      render: (v, row) => <StatusDropdown value={String(v || 'draft')} quoteId={(row as unknown as Quote).id} onUpdate={handleStatusUpdate} />,
    },
  ]

  const genericData = data as unknown as Record<string, unknown>[]
  const genericColumns = columns as unknown as ColumnDef<Record<string, unknown>>[]

  const table = useDataTable({
    data: genericData,
    columns: genericColumns,
    storageKey: 'quotes-registry',
  })

  const totalAmount = data.reduce((sum, q) => sum + (q.amount || 0), 0)

  return (
    <div className="p-4 pb-20">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">💰 {t('page.quotes')}</h1>
        <a
          href="/quotes/new"
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg transition text-sm"
        >
          ➕ New Quote
        </a>
      </div>
      <p className="text-muted-foreground text-sm mb-4">
        {t('page.quotesSubtitle')}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-amber-500/10 rounded-lg p-3">
          <p className="text-xs text-amber-600">{t('stats.totalQuotes')}</p>
          <p className="text-xl font-bold text-amber-600">{data.length}</p>
        </div>
        <div className="bg-green-500/10 rounded-lg p-3">
          <p className="text-xs text-green-500">Total Value</p>
          <p className="text-xl font-bold text-green-500">{formatCurrency(totalAmount)}</p>
        </div>
        <div className="bg-blue-500/10 rounded-lg p-3">
          <p className="text-xs text-blue-400">With PDFs</p>
          <p className="text-xl font-bold text-blue-400">
            {data.filter((q) => q.pdf_url).length}
          </p>
        </div>
      </div>

      {loading && (
        <TableSkeleton rows={8} />
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <DataTable
          table={table}
          data={genericData}
          noun="quote"
          exportFilename="quotes-registry.csv"
          page="quotes"
          initialView={initialView}
          autoExport={autoExport}
          onRowClick={(row) => handleRowClick(row as unknown as Quote)}
        />
      )}

      {/* PDF Viewer Overlay */}
      {viewingPdf && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
          onClick={() => setViewingPdf(null)}
        >
          <div className="flex items-center justify-between p-4 bg-zinc-900/90 border-b border-zinc-700">
            <h2 className="text-lg font-semibold text-white">
              📄 {viewingPdf.quoteNumber}
            </h2>
            <div className="flex gap-2">
              <a
                href={viewingPdf.url}
                download
                onClick={(e) => e.stopPropagation()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition"
              >
                ⬇️ Download
              </a>
              <button
                onClick={() => setViewingPdf(null)}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition"
              >
                ✕ Close
              </button>
            </div>
          </div>
          <div className="flex-1 p-2" onClick={(e) => e.stopPropagation()}>
            <iframe
              src={viewingPdf.url}
              className="w-full h-full rounded border border-zinc-700"
              title={`PDF: ${viewingPdf.quoteNumber}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
