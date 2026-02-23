'use client'

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { useRouter } from 'next/navigation'
import { Trash2, ExternalLink, Pencil, FileDown, FileText, FileSpreadsheet, Check, X, ExternalLinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth, isSuperAdmin } from '@/lib/auth-context'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { exportToCSV, exportToExcel } from '@/lib/export-utils'
import { TableSkeleton } from "@/components/ui/skeleton-loader"

interface SavedView {
  id: string
  user_id: string
  page: string
  name: string
  config: Record<string, unknown>
  shared: boolean
  created_at: string
  notes: string
}

interface ReportRow extends Record<string, unknown> {
  id: string
  name: string
  page: string
  pageLabel: string
  user_id: string
  notes: string
  created_at: string
  isOwn: boolean
}

const PAGE_LABELS: Record<string, string> = {
  'orders': 'Orders Data',
  'need-to-make': 'Need to Make',
  'need-to-package': 'Need to Package',
  'staged': 'Ready to Ship',
  'shipped': 'Shipped',
  'inventory': 'Inventory',
  'inventory-history': 'Inventory History',
  'pallet-records': 'Pallet Records',
  'shipping-records': 'Shipping Records',
  'all-data': 'All Data',
  'sales-by-part': 'Sales by Part',
  'sales-by-customer': 'Sales by Customer',
  'sales-by-date': 'Sales by Date',
  'quotes': 'Quotes',
  'bom': 'BOM',
  'customer-reference': 'Customer Reference',
  'fp-reference': 'FP Reference',
  'drawings': 'Drawings',
  'material-requirements': 'Material Requirements',
  'staged-records': 'Staged Records',
}

const PAGE_ROUTES: Record<string, string> = {
  'orders': '/orders',
  'need-to-make': '/need-to-make',
  'need-to-package': '/need-to-package',
  'staged': '/staged',
  'shipped': '/shipped',
  'inventory': '/inventory',
  'inventory-history': '/inventory-history',
  'pallet-records': '/pallet-records',
  'shipping-records': '/shipping-records',
  'all-data': '/all-data',
  'sales-by-part': '/sales-parts',
  'sales-by-customer': '/sales-customers',
  'sales-by-date': '/sales-dates',
  'quotes': '/quotes',
  'bom': '/bom',
  'customer-reference': '/customer-reference',
  'fp-reference': '/fp-reference',
  'drawings': '/drawings',
  'material-requirements': '/material-requirements',
  'staged-records': '/staged-records',
  'sales-overview': '/sales-overview',
  'sales-dates': '/sales-dates',
  'sales-parts': '/sales-parts',
  'sales-customers': '/sales-customers',
}

// Try to resolve a page key to a route, handling edge cases
function resolveRoute(page: string): string {
  if (PAGE_ROUTES[page]) return PAGE_ROUTES[page]
  // Try with underscores → hyphens
  const hyphenated = page.replace(/_/g, '-')
  if (PAGE_ROUTES[hyphenated]) return PAGE_ROUTES[hyphenated]
  // Try matching a known route that starts with the page key
  for (const [key, route] of Object.entries(PAGE_ROUTES)) {
    if (page.startsWith(key) || page.includes(key)) return route
    if (hyphenated.startsWith(key) || hyphenated.includes(key)) return route
  }
  // Check if it looks like a sales page
  if (page.includes('sales') && page.includes('date')) return '/sales-dates'
  if (page.includes('sales') && page.includes('part')) return '/sales-parts'
  if (page.includes('sales') && page.includes('customer')) return '/sales-customers'
  return `/${page}`
}

// Inline editable cell
function EditableCell({ value, onSave, editable }: { value: string; onSave: (v: string) => void; editable: boolean }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)

  if (!editable) return <span className="text-muted-foreground">{value || '—'}</span>

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Input value={text} onChange={(e) => setText(e.target.value)} className="h-7 text-sm" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { onSave(text); setEditing(false) } if (e.key === 'Escape') { setText(value); setEditing(false) } }}
        />
        <button onClick={() => { onSave(text); setEditing(false) }} className="p-1 hover:bg-muted rounded"><Check className="size-3" /></button>
        <button onClick={() => { setText(value); setEditing(false) }} className="p-1 hover:bg-muted rounded"><X className="size-3" /></button>
      </div>
    )
  }

  return (
    <span className="group flex items-center gap-1 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditing(true) }}>
      <span>{value || <span className="text-muted-foreground italic">Click to add</span>}</span>
      <Pencil className="size-3 opacity-0 group-hover:opacity-50" />
    </span>
  )
}

function ExportDropdown({ viewId, route }: { viewId: string; route: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        dropRef.current?.contains(e.target as Node)
      ) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function triggerExport(format: 'csv' | 'xlsx') {
    const url = `${route}?viewId=${viewId}&autoExport=${format}`
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 30000)
    setOpen(false)
  }

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.right })
    }
    setOpen(!open)
  }

  return (
    <>
      <Button ref={btnRef} variant="ghost" size="sm" onClick={handleToggle} title="Export report data">
        <FileDown className="size-3.5 mr-1" /> Export
      </Button>
      {open && pos && typeof document !== 'undefined' && ReactDOM.createPortal(
        <div
          ref={dropRef}
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg min-w-[130px] py-1"
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={(e) => { e.stopPropagation(); triggerExport('csv') }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors">
            <FileText className="size-4" /> CSV
          </button>
          <button onClick={(e) => { e.stopPropagation(); triggerExport('xlsx') }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors">
            <FileSpreadsheet className="size-4" /> Excel
          </button>
        </div>,
        document.body
      )}
    </>
  )
}

export default function ReportsPage() {
  return <Suspense><ReportsContent /></Suspense>
}

function ReportsContent() {
  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const { user, profile } = useAuth()
  const router = useRouter()
  const userId = profile?.email || user?.email || null
  const isAdmin = isSuperAdmin(userId)

  const loadViews = useCallback(async () => {
    try {
      const headers: Record<string, string> = {}
      if (userId) headers['x-user-id'] = userId
      const res = await fetch('/api/views?page=__all', { headers })
      if (!res.ok) return
      setViews(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [userId])

  useEffect(() => { loadViews() }, [loadViews])

  async function updateView(id: string, patch: Record<string, unknown>) {
    if (!userId) return
    const res = await fetch(`/api/views/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: JSON.stringify(patch),
    })
    if (res.ok) await loadViews()
  }

  async function deleteView(id: string) {
    if (!userId) return
    if (!confirm('Delete this report?')) return
    // Super admin uses a special header to delete anyone's
    const headers: Record<string, string> = { 'x-user-id': userId }
    if (isAdmin) headers['x-super-admin'] = 'true'
    const res = await fetch(`/api/views/${id}`, { method: 'DELETE', headers })
    if (res.ok) setViews((prev) => prev.filter((v) => v.id !== id))
  }

  function openReport(view: SavedView) {
    const route = resolveRoute(view.page)
    router.push(`${route}?viewId=${view.id}`)
  }

  const rows: ReportRow[] = useMemo(() => views.map((v) => ({
    id: v.id,
    name: v.name,
    page: v.page,
    pageLabel: PAGE_LABELS[v.page] || v.page,
    user_id: v.user_id,
    notes: v.notes || '',
    created_at: v.created_at,
    isOwn: v.user_id === userId,
  })), [views, userId])

  const columns: ColumnDef<ReportRow>[] = useMemo(() => [
    {
      key: 'name',
      label: 'Report Name',
      sortable: true,
      filterable: true,
      render: (_v, row) => {
        const r = row as ReportRow
        return (
          <EditableCell
            value={r.name}
            editable={r.isOwn}
            onSave={(name) => updateView(r.id, { name })}
          />
        )
      },
    },
    {
      key: 'pageLabel',
      label: 'Source Page',
      sortable: true,
      filterable: true,
      render: (v) => (
        <span className="inline-block px-2 py-0.5 rounded-full text-xs border bg-muted/50">
          {v as string}
        </span>
      ),
    },
    {
      key: 'user_id',
      label: 'Created By',
      sortable: true,
      filterable: true,
      render: (v) => (
        <span>
          {v as string}
          {v === userId && <span className="ml-1 text-xs text-blue-400">(me)</span>}
        </span>
      ),
    },
    {
      key: 'notes',
      label: 'Notes',
      sortable: false,
      filterable: false,
      render: (_v, row) => {
        const r = row as ReportRow
        return (
          <EditableCell
            value={r.notes}
            editable={r.isOwn}
            onSave={(notes) => updateView(r.id, { notes })}
          />
        )
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (v) => new Date(v as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'id',
      label: 'Actions',
      sortable: false,
      filterable: false,
      render: (_v, row) => {
        const r = row as ReportRow
        const canDelete = r.isOwn || isAdmin
        const view = views.find((v) => v.id === r.id)
        const route = view ? resolveRoute(view.page) : '#'
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" onClick={() => view && openReport(view)} title="Open report">
              <ExternalLink className="size-3.5 mr-1" /> Open
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.open(`${route}?viewId=${r.id}`, '_blank')} title="Open in new tab">
              <ExternalLinkIcon className="size-3.5 mr-1" /> New Tab
            </Button>
            <ExportDropdown viewId={r.id} route={route} />
            {canDelete && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteView(r.id)} title="Delete report">
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )
      },
    },
  ], [userId, isAdmin, views]) // eslint-disable-line react-hooks/exhaustive-deps

  const table = useDataTable({ data: rows, columns, storageKey: 'reports-list' })

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">📊 Custom Reports</h1>
        <p className="text-sm text-muted-foreground">
          Saved views from any table. Click a report to open it with your custom configuration.
        </p>
      </div>

      {loading ? (
        <TableSkeleton rows={8} />
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">No saved reports yet</p>
          <p className="text-sm">Go to any table, configure columns/filters/sort, then click <strong>Custom Views → Save</strong></p>
        </div>
      ) : (
        <DataTable
          table={table}
          data={rows}
          noun="report"
          exportFilename="custom-reports"
          page="reports"
          onRowClick={(row) => {
            const r = row as ReportRow
            const view = views.find((v) => v.id === r.id)
            if (view) openReport(view)
          }}
        />
      )}
    </div>
  )
}
