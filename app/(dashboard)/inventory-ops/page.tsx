'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
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
  ChevronUp,
  ChevronRight,
  ScanLine,
  Clock,
  ArrowLeftRight,
} from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { usePermissions } from '@/lib/use-permissions'
import { useAuth } from '@/lib/auth-context'

// Camera scanner is browser-only (getUserMedia) and heavy — load it on demand.
const PalletScanner = dynamic(() => import('@/components/inventory/PalletScanner'), { ssr: false })

interface BinLocation {
  warehouse: string
  qty: number
}
interface Pallet {
  batch: string
  warehouse: string
  qty: number
}
interface LocateResult {
  itemCode: string
  itemName: string
  uom: string
  total: number
  bins: BinLocation[]
  pallets?: Pallet[] // pallet ids for stocked items, attached by the locate route
}
interface ItemOption {
  itemCode: string
  itemName: string
}
interface Station {
  id: string
  name: string
}
interface HistEvent {
  action: string
  at: string | null
  by: string
  qty: number | null
  warehouse: string | null
}

const OFFICE_ROLES = ['admin', 'super_admin', 'manager', 'shipping_manager']

// Turn the ordered ops-log events into human timeline lines, deriving qty and
// bin transitions from the sequence itself (no need to store before/after).
function describeEvents(events: HistEvent[], t: (k: string) => string) {
  let prevQty: number | null = null
  let prevWh: string | null = null
  return events.map((e) => {
    let text: string
    switch (e.action) {
      case 'add':
        text = `${t('inventoryOps.histCreated')}${e.qty != null ? ` · ${e.qty} ${t('inventoryOps.units')}` : ''}${e.warehouse ? ` · ${e.warehouse}` : ''}`
        break
      case 'adjust':
        text =
          prevQty != null && e.qty != null
            ? `${t('inventoryOps.histAdjusted')}: ${prevQty} → ${e.qty}`
            : `${t('inventoryOps.histAdjusted')}${e.qty != null ? `: ${e.qty}` : ''}`
        break
      case 'move':
        text =
          prevWh && e.warehouse
            ? `${t('inventoryOps.histMoved')}: ${prevWh} → ${e.warehouse}`
            : `${t('inventoryOps.histMoved')}${e.warehouse ? `: ${e.warehouse}` : ''}`
        break
      case 'remove':
        text = t('inventoryOps.histRemoved')
        break
      case 'reprint':
        text = t('inventoryOps.histReprinted')
        break
      default:
        text = e.action
    }
    if (e.qty != null) prevQty = e.qty
    if (e.warehouse) prevWh = e.warehouse
    const at = e.at ? new Date(e.at) : null
    return { text, by: e.by, at: at && !isNaN(at.getTime()) ? at.toLocaleString() : '' }
  })
}
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
  const [scanOpen, setScanOpen] = useState(false)
  const [matchedPallet, setMatchedPallet] = useState<string | null>(null)

  const runSearch = useCallback(
    async (q: string, signal: AbortSignal) => {
      if (q.trim().length < 2) {
        setResults([])
        setSearched(false)
        setMatchedPallet(null)
        return
      }
      setSearching(true)
      setSearchError(null)
      try {
        const res = await authedFetch(`/api/erpnext/locate?q=${encodeURIComponent(q.trim())}`, { signal })
        if (!res.ok) throw new Error('lookup failed')
        const data = await res.json()
        const rows: LocateResult[] = data.results ?? []
        setResults(rows)
        setMatchedPallet(data.matchedPallet ?? null)
        // Seed the pallet lists from the inline pallet ids (no refetch needed).
        const seeded: Record<string, Pallet[]> = {}
        for (const r of rows) if (r.pallets) seeded[r.itemCode] = r.pallets
        if (Object.keys(seeded).length) setPallets((p) => ({ ...seeded, ...p }))
        // On an exact pallet-id scan, open that one item's pallets automatically.
        if (data.matchedPallet && rows.length === 1) setOpenItem(rows[0].itemCode)
        setSearched(true)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        setSearchError(t('inventoryOps.error'))
        setResults([])
        setMatchedPallet(null)
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
  const [palletsError, setPalletsError] = useState<Record<string, boolean>>({})

  const loadPallets = useCallback(
    async (itemCode: string) => {
      setPalletsLoading(itemCode)
      setPalletsError((e) => ({ ...e, [itemCode]: false }))
      try {
        const r = await authedFetch(`/api/erpnext/inventory/pallets?itemCode=${encodeURIComponent(itemCode)}`)
        if (!r.ok) throw new Error('pallets lookup failed')
        const d = await r.json()
        setPallets((p) => ({ ...p, [itemCode]: d.pallets ?? [] }))
      } catch {
        // A genuine fetch/ERP failure — distinct from an item that simply has no
        // pallets, so the UI doesn't show "no pallets" when it actually couldn't load.
        setPalletsError((e) => ({ ...e, [itemCode]: true }))
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

  // ─── pallet history (traceability) ───
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, HistEvent[]>>({})
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)

  const toggleHistory = useCallback(
    async (batch: string) => {
      if (historyOpen === batch) {
        setHistoryOpen(null)
        return
      }
      setHistoryOpen(batch)
      if (history[batch]) return
      setHistoryLoading(batch)
      try {
        const r = await authedFetch(`/api/erpnext/inventory/history?batch=${encodeURIComponent(batch)}`)
        const d = await r.json()
        setHistory((h) => ({ ...h, [batch]: d.events ?? [] }))
      } catch {
        setHistory((h) => ({ ...h, [batch]: [] }))
      } finally {
        setHistoryLoading(null)
      }
    },
    [historyOpen, history, authedFetch]
  )

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
  const itemListRef = useRef<HTMLDivElement>(null)
  const scrollItems = (dir: 1 | -1) => itemListRef.current?.scrollBy({ top: dir * 140, behavior: 'smooth' })

  // Keep the wheel inside the part list: scroll the list, never the page behind
  // it. overscroll-contain alone doesn't cover a short list or the gaps between
  // rows, so we take the wheel over fully (passive:false so preventDefault works).
  // Touch scrolling is unaffected — it uses the native overflow on the list.
  useEffect(() => {
    const el = itemListRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      el.scrollTop += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [itemOptions.length])
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

  // ─── move (bin transfer) ───
  const [movingBatch, setMovingBatch] = useState<string | null>(null)
  const [moveWarehouse, setMoveWarehouse] = useState('')
  const [moveWhFilter, setMoveWhFilter] = useState('')

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

  const submitMove = async (itemCode: string, batch: string) => {
    if (!moveWarehouse) return
    if (busyRef.current) return
    busyRef.current = true
    setBusyBatch(batch)
    try {
      const r = await authedFetch('/api/erpnext/inventory/move', {
        method: 'POST',
        body: JSON.stringify({ batch, itemCode, toWarehouse: moveWarehouse, idempotencyKey: uuid() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'move failed')
      showFlash('ok', `${t('inventoryOps.moved')} ${batch} -> ${moveWarehouse}`)
      setMovingBatch(null)
      setMoveWarehouse('')
      setMoveWhFilter('')
      loadPallets(itemCode)
      // drop cached history so it reloads with the new move event
      setHistory((h) => {
        const n = { ...h }
        delete n[batch]
        return n
      })
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setBusyBatch(null)
      busyRef.current = false
    }
  }

  const submitReprint = async (itemCode: string, batch: string) => {
    const station = addStation || stations[0]?.id
    if (!station) {
      showFlash('err', t('inventoryOps.addMissing'))
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setBusyBatch(batch)
    try {
      const r = await authedFetch('/api/erpnext/inventory/reprint', {
        method: 'POST',
        body: JSON.stringify({ batch, itemCode, station, idempotencyKey: uuid() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'reprint failed')
      showFlash('ok', `${t('inventoryOps.reprinted')} ${batch}`)
      if (historyOpen === batch) {
        setHistory((h) => {
          const n = { ...h }
          delete n[batch]
          return n
        })
      }
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

  const filteredMoveWarehouses = moveWhFilter
    ? warehouses.filter((w) => w.toLowerCase().includes(moveWhFilter.toLowerCase())).slice(0, 50)
    : warehouses.slice(0, 50)

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
                    <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                      {itemOptions.length > 5 && (
                        <button
                          type="button"
                          onClick={() => scrollItems(-1)}
                          aria-label={t('inventoryOps.scrollUp')}
                          className="flex w-full items-center justify-center border-b border-border bg-popover py-1.5 text-muted-foreground hover:bg-accent"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </button>
                      )}
                      <div
                        ref={itemListRef}
                        className="inv-scroll max-h-60 overflow-y-auto overscroll-contain"
                        style={{ WebkitOverflowScrolling: 'touch' }}
                      >
                        {itemOptions.map((o) => (
                          <button
                            key={o.itemCode}
                            onClick={() => {
                              setAddItem(o)
                              setItemOptions([])
                            }}
                            className="block w-full px-3 py-3 text-left text-sm hover:bg-accent"
                          >
                            <span className="font-mono">{o.itemCode}</span> — {o.itemName}
                          </button>
                        ))}
                      </div>
                      {itemOptions.length > 5 && (
                        <button
                          type="button"
                          onClick={() => scrollItems(1)}
                          aria-label={t('inventoryOps.scrollDown')}
                          className="flex w-full items-center justify-center border-t border-border bg-popover py-1.5 text-muted-foreground hover:bg-accent"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      )}
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
          className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-12 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            aria-label={t('inventoryOps.scan')}
            title={t('inventoryOps.scan')}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ScanLine className="h-5 w-5" />
          </button>
        </div>
      </div>

      {scanOpen && (
        <PalletScanner
          onClose={() => setScanOpen(false)}
          onResult={(code) => {
            setQuery(code)
            setScanOpen(false)
          }}
        />
      )}

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
                  {r.bins.map((b, i) => {
                    const binPallets = (r.pallets ?? []).filter((p) => p.warehouse === b.warehouse)
                    return (
                      <li key={i} className="text-sm">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {b.warehouse}
                          </span>
                          <span className="font-medium tabular-nums">{b.qty.toLocaleString()}</span>
                        </div>
                        {binPallets.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 pl-5">
                            {binPallets.map((p) => (
                              <span
                                key={p.batch}
                                className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                                  matchedPallet === p.batch
                                    ? 'bg-primary/15 font-semibold text-primary'
                                    : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {p.batch}
                                {p.qty ? ` · ${p.qty.toLocaleString()}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </li>
                    )
                  })}
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
                  ) : palletsError[r.itemCode] ? (
                    <button
                      onClick={() => loadPallets(r.itemCode)}
                      className="flex items-center gap-2 p-2 text-xs text-red-600 hover:underline"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      {t('inventoryOps.palletsError')}
                    </button>
                  ) : (pallets[r.itemCode] ?? []).length === 0 ? (
                    <div className="p-2 text-xs text-muted-foreground">{t('inventoryOps.noPallets')}</div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {(pallets[r.itemCode] ?? []).map((p) => (
                        <li key={p.batch} className="py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
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
                                onClick={() => toggleHistory(p.batch)}
                                title={t('inventoryOps.history')}
                                className={`hover:text-foreground ${historyOpen === p.batch ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                <Clock className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setMovingBatch(movingBatch === p.batch ? null : p.batch)
                                  setMoveWarehouse('')
                                  setMoveWhFilter('')
                                }}
                                title={t('inventoryOps.move')}
                                className={`hover:text-foreground ${movingBatch === p.batch ? 'text-primary' : 'text-muted-foreground'}`}
                              >
                                <ArrowLeftRight className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => submitReprint(r.itemCode, p.batch)}
                                disabled={busyBatch === p.batch}
                                title={t('inventoryOps.reprint')}
                                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
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
                          </div>

                          {movingBatch === p.batch && (
                            <div className="mt-2 rounded-md border border-border bg-background p-2">
                              <div className="mb-1 text-xs font-medium">{t('inventoryOps.moveTo')}</div>
                              <input
                                value={moveWhFilter}
                                onChange={(e) => setMoveWhFilter(e.target.value)}
                                placeholder={t('inventoryOps.searchBin')}
                                className="mb-1 w-full rounded border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                              />
                              <select
                                value={moveWarehouse}
                                onChange={(e) => setMoveWarehouse(e.target.value)}
                                className="w-full rounded border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                              >
                                <option value="">{t('inventoryOps.searchBin')}</option>
                                {filteredMoveWarehouses
                                  .filter((w) => w !== p.warehouse)
                                  .map((w) => (
                                    <option key={w} value={w}>
                                      {w}
                                    </option>
                                  ))}
                              </select>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  onClick={() => submitMove(r.itemCode, p.batch)}
                                  disabled={!moveWarehouse || busyBatch === p.batch}
                                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                                >
                                  {busyBatch === p.batch ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <ArrowLeftRight className="h-3.5 w-3.5" />
                                  )}
                                  {t('inventoryOps.moveConfirm')}
                                </button>
                                <button
                                  onClick={() => setMovingBatch(null)}
                                  className="rounded-lg px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                  {t('inventoryOps.cancel')}
                                </button>
                              </div>
                            </div>
                          )}

                          {historyOpen === p.batch && (
                            <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
                              {historyLoading === p.batch ? (
                                <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {t('inventoryOps.loading')}
                                </div>
                              ) : (history[p.batch] ?? []).length === 0 ? (
                                <div className="p-1 text-xs text-muted-foreground">{t('inventoryOps.noHistory')}</div>
                              ) : (
                                <ol className="space-y-1.5">
                                  {describeEvents(history[p.batch] ?? [], t).map((ev, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs">
                                      <Clock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                      <span>
                                        <span className="font-medium">{ev.text}</span>
                                        <span className="text-muted-foreground">
                                          {ev.by ? ` · ${ev.by}` : ''}
                                          {ev.at ? ` · ${ev.at}` : ''}
                                        </span>
                                      </span>
                                    </li>
                                  ))}
                                </ol>
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
