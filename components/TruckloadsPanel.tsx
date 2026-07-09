'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Truck, X } from 'lucide-react'
import { authedFetch, authedJson } from '@/lib/authed-fetch'
import { useI18n } from '@/lib/i18n'
import type { Order } from '@/lib/google-sheets-shared'

// Truckloads panel (Simon 2026-07-08): every planned "ships together" group in
// one place — next to the Pallet Load Calculator on Ready to Ship and the
// Shipping Overview. Sales (manage_truckloads) edits membership/notes or
// cancels; everyone else sees the plan. Each truckload prints a load sheet
// (order list + the trailer diagram snapshotted at creation).

export interface TruckloadOrder {
  id: string
  so_number: string
  order_key: string
  if_number: string | null
  customer: string | null
  part_number: string | null
  position: number
  status: 'pending' | 'shipped' | 'released'
  dn_number: string | null
  released_by: string | null
}

export interface Truckload {
  id: string
  load_number: string
  status: 'planned' | 'loading' | 'shipped' | 'canceled'
  notes: string | null
  created_by_name: string | null
  created_at: string
  truckload_orders: TruckloadOrder[]
}

const STATUS_STYLE: Record<Truckload['status'], string> = {
  planned: 'bg-violet-500/15 text-violet-600',
  loading: 'bg-amber-500/15 text-amber-600',
  shipped: 'bg-emerald-500/15 text-emerald-600',
  canceled: 'bg-muted text-muted-foreground',
}

export default function TruckloadsPanel({
  open,
  onClose,
  canManage,
  stagedOrders = [],
  focusId,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  canManage: boolean
  /** Ready-to-Ship orders — the add-order picker draws from these */
  stagedOrders?: Order[]
  /** scroll to / highlight this truckload when opening from a banner */
  focusId?: string | null
  /** membership changed (create/remove/cancel) — hosts refresh their banners */
  onChanged?: () => void
}) {
  const { t } = useI18n()
  const [rows, setRows] = useState<Truckload[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [addSelection, setAddSelection] = useState<Set<string>>(new Set())
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({})
  const focusRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch(`/api/truckloads?scope=${showClosed ? 'all' : 'active'}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Failed')
      setRows((body.truckloads ?? []) as Truckload[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [showClosed])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (open && focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [open, focusId, rows])

  // orders already locked in any active truckload can't be added to another
  const lockedKeys = useMemo(() => {
    const s = new Set<string>()
    for (const tl of rows) {
      if (tl.status !== 'planned' && tl.status !== 'loading') continue
      for (const o of tl.truckload_orders) if (o.status === 'pending') s.add(o.order_key)
    }
    return s
  }, [rows])

  const addCandidates = useMemo(
    () =>
      stagedOrders
        .map((o) => ({
          order: o,
          orderKey: `${o.ifNumber}||${o.partNumber}`,
          soNumber: (o.ifNumber || '').split(' ')[0],
        }))
        .filter((c) => /^(SO|SAL-ORD)-/.test(c.soNumber) && !lockedKeys.has(c.orderKey)),
    [stagedOrders, lockedKeys]
  )

  const patchTl = async (id: string, body: Record<string, unknown>, confirmMsg?: string) => {
    if (busy) return
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(id)
    setError(null)
    try {
      const res = await authedJson(`/api/truckloads/${id}`, 'PATCH', body)
      const resBody = await res.json().catch(() => null)
      if (!res.ok) throw new Error(resBody?.error || 'Failed')
      await load()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const printLoadSheet = async (tl: Truckload) => {
    try {
      const res = await authedFetch(`/api/truckloads/${tl.id}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Failed')
      const state = (body.truckload?.calculator_state ?? {}) as { svgMarkup?: string | null }
      const orders = (body.truckload?.truckload_orders ?? []) as TruckloadOrder[]
      const rowsHtml = orders
        .map(
          (o, i) => `<tr>
            <td style="text-align:center;">${i + 1}</td>
            <td style="font-family:monospace;font-weight:700;">${o.so_number}</td>
            <td>${o.if_number ?? ''}</td>
            <td>${o.customer ?? ''}</td>
            <td>${o.part_number ?? ''}</td>
            <td style="text-align:center;">${
              o.status === 'shipped'
                ? `${t('truckload.chipShipped')}${o.dn_number ? ` (${o.dn_number})` : ''}`
                : o.status === 'released'
                  ? t('truckload.chipReleased')
                  : t('truckload.chipPending')
            }</td>
          </tr>`
        )
        .join('')
      const html = `<!DOCTYPE html><html><head><title>${tl.load_number}</title><style>
        body { font-family: Arial, sans-serif; margin: 16px; color: #1a1a2e; }
        h1 { font-size: 20px; margin: 0 0 2px; } .meta { color:#666; font-size: 11px; margin-bottom: 10px; }
        .warn { background:#f5f3ff; border:2px solid #7c3aed; color:#5b21b6; border-radius:8px; padding:10px 12px; font-weight:700; font-size:13px; margin-bottom:12px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
        th { background: #5b21b6; color: white; padding: 5px 8px; text-align: left; font-size: 11px; }
        td { font-size: 11px; padding: 4px 8px; border: 1px solid #ddd; }
        .notes { background:#fffbeb; border:1px solid #f59e0b; border-radius:8px; padding:8px 12px; font-size:12px; margin-bottom:12px; white-space:pre-wrap; }
        .diagram svg { width: 100%; max-height: 300px; color:#333; } .diagram svg text { fill:#333; }
        @media print { .no-print { display:none; } } @page { margin: 8mm; }
      </style></head><body>
        <h1>🚛 ${t('truckload.sheetTitle')} — ${tl.load_number}</h1>
        <div class="meta">${new Date(tl.created_at).toLocaleString()} · ${tl.created_by_name ?? ''}</div>
        <div class="warn">${t('truckload.sheetWarn').replace('{count}', String(orders.length))}</div>
        ${tl.notes ? `<div class="notes"><b>${t('truckload.notes')}:</b> ${tl.notes}</div>` : ''}
        <table><thead><tr><th>#</th><th>SO</th><th>IF</th><th>${t('table.customer')}</th><th>${t('table.partNumber')}</th><th>${t('truckload.orderStatus')}</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
        ${state.svgMarkup ? `<div class="diagram">${state.svgMarkup}</div>` : ''}
        <div class="no-print" style="text-align:center;margin-top:16px;">
          <button onclick="window.print()" style="padding:10px 24px;background:#5b21b6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;">🖨️ ${t('truckload.printSheet')}</button>
        </div>
      </body></html>`
      const win = window.open('', '_blank')
      if (win) {
        win.opener = null
        win.document.write(html)
        win.document.close()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-background border border-border">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Truck className="size-5 text-violet-600" />
            {t('truckload.title')}
          </h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
              {t('truckload.showClosed')}
            </label>
            <button onClick={onClose} aria-label={t('truckload.close')} className="rounded-full p-2 hover:bg-muted">
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          {loading && (
            <div className="flex justify-center py-8 text-muted-foreground">
              <RefreshCw className="size-5 animate-spin" />
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">{t('truckload.empty')}</p>
          )}

          {rows.map((tl) => {
            const pending = tl.truckload_orders.filter((o) => o.status === 'pending')
            const isActive = tl.status === 'planned' || tl.status === 'loading'
            const isFocus = tl.id === focusId
            return (
              <div
                key={tl.id}
                ref={isFocus ? focusRef : undefined}
                className={`rounded-xl border p-3 space-y-2 ${
                  isFocus ? 'border-violet-500 ring-2 ring-violet-500/30' : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-base">{tl.load_number}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLE[tl.status]}`}>
                    {t(`truckload.status.${tl.status}`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {tl.created_by_name ?? ''} · {new Date(tl.created_at).toLocaleDateString()}
                  </span>
                  <div className="ml-auto flex gap-1.5">
                    <button
                      onClick={() => printLoadSheet(tl)}
                      className="px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs font-semibold"
                    >
                      🖨️ {t('truckload.printSheet')}
                    </button>
                    {canManage && isActive && (
                      <button
                        onClick={() => patchTl(tl.id, { cancel: true }, t('truckload.cancelConfirm'))}
                        disabled={busy === tl.id}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        {t('truckload.cancelTl')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Orders */}
                <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                  {tl.truckload_orders.map((o) => (
                    <div key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono font-semibold truncate">
                          {o.so_number}
                          {o.if_number && o.if_number !== o.so_number ? ` · ${o.if_number}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {o.customer} {o.part_number ? `· ${o.part_number}` : ''}
                        </p>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                          o.status === 'shipped'
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : o.status === 'released'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-violet-500/15 text-violet-600'
                        }`}
                      >
                        {o.status === 'shipped'
                          ? `${t('truckload.chipShipped')}${o.dn_number ? ` ${o.dn_number}` : ''}`
                          : o.status === 'released'
                            ? `${t('truckload.chipReleased')}${o.released_by ? ` · ${o.released_by}` : ''}`
                            : t('truckload.chipPending')}
                      </span>
                      {canManage && isActive && o.status === 'pending' && (
                        <button
                          onClick={() =>
                            patchTl(tl.id, { removeOrderKeys: [o.order_key] }, t('truckload.removeConfirm'))
                          }
                          disabled={busy === tl.id}
                          aria-label={t('truckload.remove')}
                          className="rounded-full p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {isActive && pending.length === 1 && (
                  <p className="text-xs text-amber-600">{t('truckload.singleLeft')}</p>
                )}

                {/* Notes + add orders (managers) */}
                {canManage && isActive && (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={notesDraft[tl.id] ?? tl.notes ?? ''}
                        onChange={(e) => setNotesDraft((d) => ({ ...d, [tl.id]: e.target.value }))}
                        placeholder={t('truckload.notesPlaceholder')}
                        className="flex-1 px-3 py-2 rounded-lg border bg-background text-sm"
                      />
                      {(notesDraft[tl.id] ?? tl.notes ?? '') !== (tl.notes ?? '') && (
                        <button
                          onClick={() => patchTl(tl.id, { notes: notesDraft[tl.id] ?? '' })}
                          disabled={busy === tl.id}
                          className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
                        >
                          {t('truckload.save')}
                        </button>
                      )}
                    </div>
                    {addingTo === tl.id ? (
                      <div className="rounded-lg border border-border p-2 space-y-2">
                        <div data-lenis-prevent className="max-h-44 overflow-y-auto space-y-1">
                          {addCandidates.length === 0 && (
                            <p className="text-xs text-muted-foreground px-1 py-2">{t('truckload.noCandidates')}</p>
                          )}
                          {addCandidates.map((c) => (
                            <label key={c.orderKey} className="flex items-start gap-2 text-xs cursor-pointer px-1">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={addSelection.has(c.orderKey)}
                                onChange={(e) =>
                                  setAddSelection((s) => {
                                    const next = new Set(s)
                                    if (e.target.checked) next.add(c.orderKey)
                                    else next.delete(c.orderKey)
                                    return next
                                  })
                                }
                              />
                              <span>
                                <span className="font-mono font-semibold">{c.soNumber}</span> · {c.order.customer} ·{' '}
                                {c.order.partNumber}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setAddingTo(null)
                              setAddSelection(new Set())
                            }}
                            className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold"
                          >
                            {t('truckload.cancel')}
                          </button>
                          <button
                            onClick={() => {
                              const adds = addCandidates
                                .filter((c) => addSelection.has(c.orderKey))
                                .map((c) => ({
                                  soNumber: c.soNumber,
                                  orderKey: c.orderKey,
                                  ifNumber: c.order.ifNumber,
                                  customer: c.order.customer,
                                  partNumber: c.order.partNumber,
                                }))
                              setAddingTo(null)
                              setAddSelection(new Set())
                              if (adds.length) patchTl(tl.id, { addOrders: adds })
                            }}
                            disabled={addSelection.size === 0 || busy === tl.id}
                            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-50"
                          >
                            {t('truckload.addSelected')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAddingTo(tl.id)}
                        className="px-3 py-1.5 rounded-lg border border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-violet-500 hover:text-violet-600"
                      >
                        + {t('truckload.addOrders')}
                      </button>
                    )}
                  </div>
                )}
                {!canManage && tl.notes && (
                  <p className="text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 whitespace-pre-wrap">
                    <b>{t('truckload.notes')}:</b> {tl.notes}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
