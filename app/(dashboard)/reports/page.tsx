'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, ExternalLink, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth-context'
import { useI18n } from '@/lib/i18n'

interface SavedView {
  id: string
  user_id: string
  page: string
  name: string
  config: Record<string, unknown>
  shared: boolean
  created_at: string
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
}

// Map page key to its route
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
}

export default function ReportsPage() {
  const [views, setViews] = useState<SavedView[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCreator, setFilterCreator] = useState<string>('all')
  const { user, profile } = useAuth()
  const { t } = useI18n()
  const router = useRouter()
  const userId = profile?.email || user?.email || null

  async function loadViews() {
    try {
      const headers: Record<string, string> = {}
      if (userId) headers['x-user-id'] = userId
      // Fetch all pages
      const res = await fetch('/api/views?page=__all', { headers })
      if (!res.ok) return
      setViews(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }

  useEffect(() => { loadViews() }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const creators = useMemo(() => {
    const set = new Set(views.map((v) => v.user_id))
    return [...set].sort()
  }, [views])

  const filtered = useMemo(() => {
    let list = views
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((v) => v.name.toLowerCase().includes(q) || (PAGE_LABELS[v.page] || v.page).toLowerCase().includes(q))
    }
    if (filterCreator !== 'all') {
      list = list.filter((v) => v.user_id === filterCreator)
    }
    return list
  }, [views, search, filterCreator])

  function openReport(view: SavedView) {
    const route = PAGE_ROUTES[view.page] || `/${view.page}`
    // Pass view ID as query param — the page will load and apply the config
    router.push(`${route}?viewId=${view.id}`)
  }

  async function deleteView(id: string) {
    if (!userId) return
    if (!confirm('Delete this report?')) return
    const res = await fetch(`/api/views/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': userId },
    })
    if (res.ok) setViews((prev) => prev.filter((v) => v.id !== id))
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">📊 Custom Reports</h1>
        <p className="text-sm text-muted-foreground">
          Saved views from any table. Click a report to open it with your custom configuration.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={filterCreator}
            onChange={(e) => setFilterCreator(e.target.value)}
            className="h-9 rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All creators</option>
            {creators.map((c) => (
              <option key={c} value={c}>{c === userId ? `${c} (me)` : c}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">No saved reports yet</p>
          <p className="text-sm">Go to any table, configure columns/filters/sort, then click <strong>Custom Views → Save</strong></p>
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left font-medium px-3 py-2">Report Name</th>
                <th className="text-left font-medium px-3 py-2">Source Page</th>
                <th className="text-left font-medium px-3 py-2">Created By</th>
                <th className="text-left font-medium px-3 py-2">Created</th>
                <th className="text-right font-medium px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((view) => {
                const isOwn = view.user_id === userId
                return (
                  <tr key={view.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => openReport(view)}>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-blue-400 hover:underline">{view.name}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs border bg-muted/50">
                        {PAGE_LABELS[view.page] || view.page}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {view.user_id}
                      {isOwn && <span className="ml-1 text-xs text-blue-400">(me)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {new Date(view.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon-xs" onClick={() => openReport(view)} title="Open report">
                          <ExternalLink className="size-3.5" />
                        </Button>
                        {isOwn && (
                          <Button variant="ghost" size="icon-xs" className="text-destructive" onClick={() => deleteView(view.id)} title="Delete">
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
