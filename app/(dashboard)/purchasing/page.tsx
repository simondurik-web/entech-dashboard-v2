'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Plus, Check, ShoppingCart, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable } from '@/components/data-table/DataTable'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { authHeaders } from '@/lib/session-token'
import { toast } from '@/lib/use-toast'
import { Card, CardContent } from '@/components/ui/card'
import { toRow } from '@/lib/purchasing/compute'
import type { PurchasingOrder, PurchasingRow, PurchasingInput } from '@/lib/purchasing/types'
import { PurchasingForm } from '@/components/purchasing/PurchasingForm'
import { PurchasingDetail } from '@/components/purchasing/PurchasingDetail'
import { AuditTrailPanel } from '@/components/purchasing/AuditTrailPanel'

const STATUS_STYLES: Record<string, string> = {
  Requested: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  Ordered: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Received: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Canceled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  Refunded: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
}

const STATUS_ORDER = ['Requested', 'Ordered', 'Received', 'Partial', 'Canceled', 'Refunded'] as const

function money(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function money4(v: unknown): string {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)
}
function fmtDate(v: unknown): string {
  if (!v) return '—'
  const s = String(v)
  const d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''))
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString()
}
/** Only allow http(s)/mailto links to be clickable — blocks javascript:/data: URLs. */
function safeHref(u: unknown): string | null {
  if (!u) return null
  try {
    const p = new URL(String(u))
    return ['http:', 'https:', 'mailto:'].includes(p.protocol) ? String(u) : null
  } catch {
    return null
  }
}

export default function PurchasingPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [orders, setOrders] = useState<PurchasingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PurchasingOrder | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [auditKey, setAuditKey] = useState(0)

  const canEdit = !!user

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/purchasing', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setOrders(d.orders ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : t('purchasing.toast.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const rows: PurchasingRow[] = useMemo(() => orders.map(toRow), [orders])

  const columns: ColumnDef<PurchasingRow>[] = useMemo(() => {
    const dash = (v: unknown) => (v == null || v === '' ? '—' : String(v))
    const boolCell = (v: unknown) =>
      v ? <Check className="size-4 text-green-600" /> : <span className="text-muted-foreground">—</span>
    return [
      { key: 'item_description', label: t('purchasing.col.itemDescription'), sortable: true, filterable: false, render: dash },
      {
        key: 'order_status', label: t('purchasing.col.orderStatus'), sortable: true, filterable: true,
        render: (v) => {
          const s = String(v ?? '')
          if (!s) return <span className="text-muted-foreground">—</span>
          return <Badge className={STATUS_STYLES[s] ?? ''}>{t(`purchasing.status.${s}`)}</Badge>
        },
      },
      { key: 'department', label: t('purchasing.col.department'), sortable: true, filterable: true, render: dash },
      { key: 'quantity', label: t('purchasing.col.quantity'), sortable: true, filterable: false, render: (v: unknown) => (v == null ? '—' : Number(v).toLocaleString()) },
      { key: 'total_cost', label: t('purchasing.col.totalCost'), sortable: true, filterable: false, render: money },
      { key: 'cost_per_unit', label: t('purchasing.col.costPerUnit'), sortable: true, filterable: false, render: money4 },
      { key: 'delivery_cost', label: t('purchasing.col.deliveryCost'), sortable: true, filterable: false, render: money },
      { key: 'urgent', label: t('purchasing.col.urgent'), sortable: true, filterable: true, render: boolCell },
      { key: 'requestor', label: t('purchasing.col.requestor'), sortable: true, filterable: true, render: dash },
      { key: 'sub_department', label: t('purchasing.col.subDepartment'), sortable: true, filterable: true, render: dash },
      { key: 'deliver_to', label: t('purchasing.col.deliverTo'), sortable: true, filterable: true, render: dash },
      { key: 'store', label: t('purchasing.col.store'), sortable: true, filterable: true, render: dash },
      { key: 'date_requested', label: t('purchasing.col.dateRequested'), sortable: true, filterable: false, render: fmtDate },
      { key: 'date_ordered', label: t('purchasing.col.dateOrdered'), sortable: true, filterable: false, render: fmtDate },
      { key: 'promised_date', label: t('purchasing.col.promisedDate'), sortable: true, filterable: false, render: fmtDate },
      {
        key: 'days_until_delivery', label: t('purchasing.col.daysUntil'), sortable: true, filterable: false,
        render: (v: unknown, row: PurchasingRow) => {
          if (row.order_status !== 'Ordered') return <span className="text-muted-foreground">—</span>
          if (v == null || row.promised_date == null) return <span className="text-amber-600 dark:text-amber-400 text-xs">{t('purchasing.missingPromised')}</span>
          const n = Number(v)
          return <span className={n < 0 ? 'font-medium text-red-600 dark:text-red-400' : ''}>{n} {t('purchasing.daysShort')}</span>
        },
      },
      { key: 'received_date', label: t('purchasing.col.receivedDate'), sortable: true, filterable: false, render: fmtDate },
      { key: 'received_by', label: t('purchasing.col.receivedBy'), sortable: true, filterable: true, render: dash },
      { key: 'poe_cc', label: t('purchasing.col.poeCc'), sortable: true, filterable: true, render: dash },
      { key: 'external_number', label: t('purchasing.col.externalNumber'), sortable: true, filterable: false, render: dash },
      {
        key: 'supplier_link', label: t('purchasing.col.supplierLink'), sortable: false, filterable: false,
        render: (v) => { const h = safeHref(v); return h ? <a href={h} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t('purchasing.openLink')}</a> : (v ? String(v) : '—') },
      },
      { key: 'notes', label: t('purchasing.col.notes'), sortable: false, filterable: false, render: dash },
    ]
  }, [t])

  const table = useDataTable({ data: rows, columns, storageKey: 'purchasing-v2' })

  // Default view shows only the Molding and Melt line departments (incl. spelling
  // variants like "Melt Line"). Everything else — Rubber, Office, blanks, etc. —
  // is hidden until the user adds it back via the Department column filter.
  const deptDefaultApplied = useRef(false)
  useEffect(() => {
    if (deptDefaultApplied.current || rows.length === 0) return
    deptDefaultApplied.current = true
    const depts = new Set<string>()
    for (const r of rows) depts.add(r.department == null ? '' : String(r.department))
    const allowed = new Set(
      [...depts].filter((d) => /molding/i.test(d) || /melt\s*line/i.test(d))
    )
    if (allowed.size > 0 && allowed.size < depts.size) table.setFilter('department', allowed)
  }, [rows, table])

  // Status quick-filter bar. Counts respect other active filters (e.g. the
  // department default) but not the status filter itself, so they stay stable.
  const contextRows = useMemo(() => {
    let r = rows
    for (const [k, vals] of table.filters) {
      if (k === 'order_status') continue
      r = r.filter((x) => vals.has(String(x[k as keyof PurchasingRow] ?? '')))
    }
    return r
  }, [rows, table.filters])
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const x of contextRows) { const s = x.order_status || ''; c[s] = (c[s] || 0) + 1 }
    return c
  }, [contextRows])
  const activeStatusFilter = table.filters.get('order_status')
  const activeStatus = activeStatusFilter && activeStatusFilter.size === 1 ? [...activeStatusFilter][0] : null
  const setStatus = (s: string | null) => {
    if (s == null) table.clearFilter('order_status')
    else table.setFilter('order_status', new Set([s]))
  }

  // A function (not a memoized object) so each request reads the LIVE token —
  // a memoized object would freeze a token that expires after ~1h on long-open tabs.
  const writeHeaders = useCallback(
    () => authHeaders({ 'Content-Type': 'application/json' }),
    []
  )

  const openAdd = () => { setEditing(null); setDialogOpen(true) }
  const openEdit = (row: PurchasingRow) => { setEditing(row); setDialogOpen(true) }

  const submitForm = async (input: PurchasingInput) => {
    setSubmitting(true)
    try {
      const url = editing ? `/api/purchasing/${editing.id}` : '/api/purchasing'
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: writeHeaders(), body: JSON.stringify(input) })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${res.status}`)
      }
      setDialogOpen(false)
      setEditing(null)
      await load()
      setAuditKey((k) => k + 1)
      toast({ title: t('purchasing.toast.saved'), type: 'success' })
    } catch (e) {
      toast({ title: t('purchasing.toast.saveFailed'), description: e instanceof Error ? e.message : undefined, type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  // Quick inline patch (e.g. set received date → status auto-flips to Received).
  const quickPatch = async (row: PurchasingRow, input: PurchasingInput) => {
    try {
      const res = await fetch(`/api/purchasing/${row.id}`, { method: 'PATCH', headers: writeHeaders(), body: JSON.stringify(input) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      // Update just this row in place (no full-table skeleton flash).
      setOrders((prev) => prev.map((o) => (o.id === row.id ? (d.order ?? { ...o, ...input }) : o)))
      setAuditKey((k) => k + 1)
      toast({ title: t('purchasing.toast.saved'), type: 'success' })
    } catch (e) {
      toast({ title: t('purchasing.toast.saveFailed'), description: e instanceof Error ? e.message : undefined, type: 'error' })
    }
  }

  const deleteRow = async (row: PurchasingRow) => {
    if (!window.confirm(t('purchasing.confirmDelete').replace('{item}', row.item_description || ''))) return
    try {
      const res = await fetch(`/api/purchasing/${row.id}`, { method: 'DELETE', headers: writeHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setExpandedRowKey(null)
      await load()
      setAuditKey((k) => k + 1)
      toast({ title: t('purchasing.toast.deleted'), type: 'success' })
    } catch (e) {
      toast({ title: t('purchasing.toast.deleteFailed'), description: e instanceof Error ? e.message : undefined, type: 'error' })
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShoppingCart className="size-6" />{t('purchasing.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('purchasing.subtitle')}</p>
        </div>
        {canEdit && (
          <Button onClick={openAdd}>
            <Plus className="mr-1.5 size-4" />{t('purchasing.addItem')}
          </Button>
        )}
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">{t('purchasing.tab.orders')}</TabsTrigger>
          <TabsTrigger value="audit">{t('purchasing.tab.audit')}</TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4" />{error}
            </div>
          )}
          {loading ? (
            <TableSkeleton />
          ) : (
            <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setStatus(null)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${activeStatus === null ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent'}`}
              >
                {t('purchasing.status.all')} <span className="opacity-70">{contextRows.length}</span>
              </button>
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${activeStatus === s ? `${STATUS_STYLES[s]} border-transparent ring-2 ring-primary/40` : 'border-input hover:bg-accent'}`}
                >
                  {t(`purchasing.status.${s}`)} <span className="opacity-70">{statusCounts[s] || 0}</span>
                </button>
              ))}
            </div>
            <DataTable
              table={table}
              data={rows}
              noun={t('purchasing.noun')}
              exportFilename="purchasing"
              page="purchasing"
              disableAnimation
              getRowKey={(row) => row.id}
              expandedRowKey={expandedRowKey}
              onRowClick={(row) => setExpandedRowKey((k) => (k === row.id ? null : row.id))}
              renderExpandedContent={(row) => (
                <PurchasingDetail row={row} onEdit={openEdit} onDelete={deleteRow} onQuickPatch={quickPatch} canEdit={canEdit} />
              )}
              renderCard={(row) => {
                const expanded = expandedRowKey === row.id
                return (
                  <Card className="border-l-4">
                    <CardContent className="space-y-2 px-4 pb-3 pt-4">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setExpandedRowKey((k) => (k === row.id ? null : row.id))}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold">{row.item_description || '—'}</p>
                          {row.order_status && <Badge className={STATUS_STYLES[row.order_status] ?? ''}>{t(`purchasing.status.${row.order_status}`)}</Badge>}
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                          <span>{t('purchasing.col.department')}: <span className="text-foreground">{row.department || '—'}</span></span>
                          <span>{t('purchasing.col.quantity')}: <span className="text-foreground">{row.quantity == null ? '—' : Number(row.quantity).toLocaleString()}</span></span>
                          <span>{t('purchasing.col.totalCost')}: <span className="text-foreground">{money(row.total_cost)}</span></span>
                          <span>{t('purchasing.col.dateRequested')}: <span className="text-foreground">{fmtDate(row.date_requested)}</span></span>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t pt-3">
                          <PurchasingDetail row={row} onEdit={openEdit} onDelete={deleteRow} onQuickPatch={quickPatch} canEdit={canEdit} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              }}
            />
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AuditTrailPanel refreshKey={auditKey} />
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setEditing(null) }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('purchasing.editItem') : t('purchasing.addItem')}</DialogTitle>
          </DialogHeader>
          {dialogOpen && (
            <PurchasingForm
              order={editing}
              submitting={submitting}
              onSubmit={submitForm}
              onCancel={() => { setDialogOpen(false); setEditing(null) }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
