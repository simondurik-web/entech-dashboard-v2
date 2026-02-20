'use client'

import { useEffect, useState, useCallback } from 'react'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'

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

function statusBadge(s: string) {
  const colors: Record<string, string> = {
    draft: 'bg-zinc-700 text-zinc-300',
    sent: 'bg-blue-900/50 text-blue-400',
    accepted: 'bg-green-900/50 text-green-400',
    declined: 'bg-red-900/50 text-red-400',
    expired: 'bg-amber-900/50 text-amber-400',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[s] || colors.draft}`}>
      {s}
    </span>
  )
}

export default function QuotesPage() {
  const [data, setData] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewingPdf, setViewingPdf] = useState<{ url: string; quoteNumber: string } | null>(null)
  const [hoveredQuote, setHoveredQuote] = useState<string | null>(null)
  const { t } = useI18n()

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
      key: 'status',
      label: 'Status',
      sortable: true,
      filterable: true,
      render: (v) => statusBadge(String(v || 'draft')),
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
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && (
        <DataTable
          table={table}
          data={genericData}
          noun="quote"
          exportFilename="quotes-registry.csv"
          page="quotes"
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
