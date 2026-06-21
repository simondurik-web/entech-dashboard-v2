'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Search,
  MapPin,
  Package,
  Loader2,
  AlertCircle,
  Plus,
  Printer,
  Check,
  X,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { usePermissions } from '@/lib/use-permissions'
import { useAuth } from '@/lib/auth-context'

interface BinLocation {
  warehouse: string
  qty: number
}
interface LocateResult {
  itemCode: string
  itemName: string
  uom: string
  total: number
  bins: BinLocation[]
}
interface Pallet {
  batch: string
  warehouse: string
  qty: number
}
interface ItemOption {
  itemCode: string
  itemName: string
}
interface Station {
  id: string
  name: string
}

const OFFICE_ROLES = ['admin', 'super_admin', 'manager', 'shipping_manager']
const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export default function InventoryOpsPage() {
  const { t } = useI18n()
  const { canAccess } = usePermissions()
  const { user, profile } = useAuth()
  const isOffice = OFFICE_ROLES.includes(profile?.role ?? '')

  // Synchronous in-flight guard (state updates are async — a rapid double-click
  // would otherwise fire two requests). addKeyRef keeps the SAME idempotency key
  // across retries of one add, so a timeout+retry can't create a second receipt.
  const busyRef = useRef(false)
  const addKeyRef = useRef<string | null>(null)

  const authedFetch = useCallback(
    (url: string, opts: RequestInit = {}) =>
      fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'x-user-id': user?.id ?? '', ...(opts.headers ?? {}) },
      }),
    [user?.id]
  )

  // ─── reference data ───
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [defaultWarehouse, setDefaultWarehouse] = useState('')
  const [stations, setStations] = useState<Station[]>([])

  useEffect(() => {
    if (!user?.id) return
    authedFetch('/api/erpnext/inventory/warehouses')
      .then((r) => r.json())
      .then((d) => {
        setWarehouses(d.warehouses ?? [])
        setDefaultWarehouse(d.default ?? '')
      })
      .catch(() => {})
    authedFetch('/api/erpnext/print-stations')
      .then((r) => r.json())
      .then((d) => setStations(d.stations ?? []))
      .catch(() => {})
  }, [user?.id, authedFetch])

  // ─── search ───
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LocateResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const runSearch = useCallback(
    async (q: string, signal: AbortSignal) => {
      if (q.trim().length < 2) {
        setResults([])
        setSearched(false)
        return
      }
      setSearching(true)
      setSearchError(null)
      try {
        const res = await authedFetch(`/api/erpnext/locate?q=${encodeURIComponent(q.trim())}`, { signal })
        if (!res.ok) throw new Error('lookup failed')
        const data = await res.json()
        setResults(data.results ?? [])
        setSearched(true)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        setSearchError(t('inventoryOps.error'))
        setResults([])
      } finally {
        if (!signal.aborted) setSearching(false)
      }
    },
    [t, authedFetch]
  )

  useEffect(() => {
    const c = new AbortController()
    const id = setTimeout(() => runSearch(query, c.signal), 350)
    return () => {
      clearTimeout(id)
      c.abort()
    }
  }, [query, runSearch])

  // ─── pallets (per item, lazy) ───
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [pallets, setPallets] = useState<Record<string, Pallet[]>>({})
  const [palletsLoading, setPalletsLoading] = useState<string | null>(null)

  const loadPallets = useCallback(
    async (itemCode: string) => {
      setPalletsLoading(itemCode)
      try {
        const r = await authedFetch(`/api/erpnext/inventory/pallets?itemCode=${encodeURIComponent(itemCode)}`)
        const d = await r.json()
        setPallets((p) => ({ ...p, [itemCode]: d.pallets ?? [] }))
      } catch {
        setPallets((p) => ({ ...p, [itemCode]: [] }))
      } finally {
        setPalletsLoading(null)
      }
    },
    [authedFetch]
  )

  const toggleItem = (itemCode: string) => {
    if (openItem === itemCode) {
      setOpenItem(null)
    } else {
      setOpenItem(itemCode)
      if (!pallets[itemCode]) loadPallets(itemCode)
    }
  }

  // ─── flash + refresh helper ───
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showFlash = (kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg })
    if (flashRef.current) clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setFlash(null), 5000)
  }
  const refreshSearch = useCallback(() => {
    const c = new AbortController()
    runSearch(query, c.signal)
  }, [query, runSearch])

  // ─── add ───
  const [addOpen, setAddOpen] = useState(false)
  const [addItem, setAddItem] = useState<ItemOption | null>(null)
  const [itemQuery, setItemQuery] = useState('')
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([])
  const [addQty, setAddQty] = useState('')
  const [addWarehouse, setAddWarehouse] = useState('')
  const [whFilter, setWhFilter] = useState('')
  const [addStation, setAddStation] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (defaultWarehouse) setAddWarehouse(defaultWarehouse)
  }, [defaultWarehouse])
  useEffect(() => {
    if (stations[0] && !addStation) setAddStation(stations[0].id)
  }, [stations, addStation])

  useEffect(() => {
    if (itemQuery.trim().length < 2) {
      setItemOptions([])
      return
    }
    const c = new AbortController()
    const id = setTimeout(async () => {
      try {
        const r = await authedFetch(`/api/erpnext/inventory/items?q=${encodeURIComponent(itemQuery.trim())}`, {
          signal: c.signal,
        })
        const d = await r.json()
        setItemOptions(d.items ?? [])
      } catch {
        /* ignore */
      }
    }, 300)
    return () => {
      clearTimeout(id)
      c.abort()
    }
  }, [itemQuery, authedFetch])

  const submitAdd = async () => {
    const qty = Number(addQty)
    if (!addItem || !(qty > 0) || !addWarehouse || !addStation) {
      showFlash('err', t('inventoryOps.addMissing'))
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    if (!addKeyRef.current) addKeyRef.current = uuid() // reused across retries
    setAdding(true)
    try {
      const r = await authedFetch('/api/erpnext/inventory/add', {
        method: 'POST',
        body: JSON.stringify({
          itemCode: addItem.itemCode,
          qty,
          warehouse: addWarehouse,
          station: addStation,
          idempotencyKey: addKeyRef.current,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'add failed')
      addKeyRef.current = null // success -> next add gets a fresh key
      showFlash('ok', `${t('inventoryOps.added')} ${d.batch}${d.labelPending ? ` (${t('inventoryOps.labelPending')})` : ''}`)
      const addedItem = addItem.itemCode
      setAddItem(null)
      setItemQuery('')
      setAddQty('')
      setAddOpen(false)
      if (query) refreshSearch()
      if (openItem === addedItem) loadPallets(addedItem)
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setAdding(false)
      busyRef.current = false
    }
  }

  // ─── edit / remove ───
  const [editBatch, setEditBatch] = useState<string | null>(null)
  const [editQty, setEditQty] = useState('')
  const [busyBatch, setBusyBatch] = useState<string | null>(null)

  const submitAdjust = async (itemCode: string, batch: string) => {
    const qty = Number(editQty)
    if (!(qty >= 0)) return
    if (busyRef.current) return
    busyRef.current = true
    setBusyBatch(batch)
    try {
      const r = await authedFetch('/api/erpnext/inventory/adjust', {
        method: 'POST',
        body: JSON.stringify({ batch, itemCode, newQty: qty, station: addStation || stations[0]?.id, idempotencyKey: uuid() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'adjust failed')
      showFlash('ok', `${t('inventoryOps.adjusted')} ${batch} -> ${qty}`)
      setEditBatch(null)
      loadPallets(itemCode)
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setBusyBatch(null)
      busyRef.current = false
    }
  }

  const submitRemove = async (itemCode: string, batch: string) => {
    const reason = window.prompt(t('inventoryOps.removeReason'))
    if (!reason?.trim()) return
    if (busyRef.current) return
    busyRef.current = true
    setBusyBatch(batch)
    try {
      const r = await authedFetch('/api/erpnext/inventory/remove', {
        method: 'POST',
        body: JSON.stringify({ batch, itemCode, reason: reason.trim(), idempotencyKey: uuid() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'remove failed')
      showFlash('ok', `${t('inventoryOps.removed')} ${batch}`)
      loadPallets(itemCode)
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setBusyBatch(null)
      busyRef.current = false
    }
  }

  if (!canAccess('/inventory-ops')) {
    return <div className="p-8 text-sm text-muted-foreground">{t('inventoryOps.noAccess')}</div>
  }

  const filteredWarehouses = whFilter
    ? warehouses.filter((w) => w.toLowerCase().includes(whFilter.toLowerCase())).slice(0, 50)
    : warehouses.slice(0, 50)

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Package className="h-6 w-6" />
            {t('inventoryOps.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('inventoryOps.subtitle')}</p>
        </div>
        <button
          onClick={() => setAddOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t('inventoryOps.addInventory')}
        </button>
      </header>

      {flash && (
        <div
          className={`mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm ${
            flash.kind === 'ok'
              ? 'border-green-300 bg-green-50 text-green-800'
              : 'border-red-300 bg-red-50 text-red-700'
          }`}
        >
          {flash.kind === 'ok' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {flash.msg}
        </div>
      )}

      {/* Add panel */}
      {addOpen && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 text-sm font-medium">{t('inventoryOps.addInventory')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.part')}</label>
              {addItem ? (
                <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono">{addItem.itemCode}</span> — {addItem.itemName}
                  </span>
                  <button onClick={() => setAddItem(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={itemQuery}
                    onChange={(e) => setItemQuery(e.target.value)}
                    placeholder={t('inventoryOps.searchPart')}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  {itemOptions.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover shadow-lg">
                      {itemOptions.map((o) => (
                        <button
                          key={o.itemCode}
                          onClick={() => {
                            setAddItem(o)
                            setItemOptions([])
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <span className="font-mono">{o.itemCode}</span> — {o.itemName}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.quantity')}</label>
              <input
                type="number"
                min="1"
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.printer')}</label>
              <select
                value={addStation}
                onChange={(e) => setAddStation(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              >
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.bin')}</label>
              <input
                value={whFilter}
                onChange={(e) => setWhFilter(e.target.value)}
                placeholder={t('inventoryOps.searchBin')}
                className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <select
                value={addWarehouse}
                onChange={(e) => setAddWarehouse(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              >
                {!filteredWarehouses.includes(addWarehouse) && addWarehouse && (
                  <option value={addWarehouse}>{addWarehouse}</option>
                )}
                {filteredWarehouses.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={submitAdd}
              disabled={adding}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              {t('inventoryOps.addAndPrint')}
            </button>
            <button onClick={() => setAddOpen(false)} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              {t('inventoryOps.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('inventoryOps.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {searchError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {searchError}
        </div>
      )}
      {!searchError && searched && !searching && results.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('inventoryOps.noResults')}</p>
      )}

      <div className="space-y-3">
        {results.map((r) => (
          <div key={r.itemCode} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <div className="font-medium">{r.itemName}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.itemCode}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">{r.total.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">
                  {r.uom} {t('inventoryOps.onHand')}
                </div>
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              {r.bins.length === 0 ? (
                <div className="text-xs text-muted-foreground">{t('inventoryOps.noStock')}</div>
              ) : (
                <ul className="space-y-1.5">
                  {r.bins.map((b, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {b.warehouse}
                      </span>
                      <span className="font-medium tabular-nums">{b.qty.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => toggleItem(r.itemCode)}
                className="mt-3 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {openItem === r.itemCode ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {t('inventoryOps.managePallets')}
              </button>

              {openItem === r.itemCode && (
                <div className="mt-2 rounded-lg border border-border bg-background p-2">
                  {palletsLoading === r.itemCode ? (
                    <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('inventoryOps.loading')}
                    </div>
                  ) : (pallets[r.itemCode] ?? []).length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">{t('inventoryOps.noPallets')}</div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {(pallets[r.itemCode] ?? []).map((p) => (
                        <li key={p.batch} className="flex items-center justify-between gap-2 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-mono text-xs">{p.batch}</div>
                            <div className="text-xs text-muted-foreground">{p.warehouse}</div>
                          </div>
                          {editBatch === p.batch ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                                className="w-20 rounded border border-border bg-background px-2 py-1 text-sm"
                              />
                              <button
                                onClick={() => submitAdjust(r.itemCode, p.batch)}
                                disabled={busyBatch === p.batch}
                                className="rounded bg-primary p-1.5 text-primary-foreground disabled:opacity-50"
                              >
                                {busyBatch === p.batch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                              </button>
                              <button onClick={() => setEditBatch(null)} className="rounded p-1.5 text-muted-foreground hover:text-foreground">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3">
                              <span className="font-semibold tabular-nums">{p.qty.toLocaleString()}</span>
                              <button
                                onClick={() => {
                                  setEditBatch(p.batch)
                                  setEditQty(String(p.qty))
                                }}
                                title={t('inventoryOps.editQty')}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {isOffice && (
                                <button
                                  onClick={() => submitRemove(r.itemCode, p.batch)}
                                  disabled={busyBatch === p.batch}
                                  title={t('inventoryOps.remove')}
                                  className="text-muted-foreground hover:text-red-600 disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
