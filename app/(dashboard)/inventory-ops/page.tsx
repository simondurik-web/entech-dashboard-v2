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
  ScanLine,
  Clock,
  ArrowLeftRight,
  FileText,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  PackageCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { usePermissions } from '@/lib/use-permissions'
import { useAuth } from '@/lib/auth-context'
import { BinCombobox } from '@/components/inventory/BinCombobox'

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
  weightLb?: number
  dims?: string
  printedAt?: string | null // station name the label was LAST sent to
}
// A pallet's live reservation to a Sales Order (from ERPNext), surfaced as a badge.
interface BatchReservation {
  batch: string
  so: string
  customer: string | null
  poNo: string | null
  reservedQty: number
  status: string
}
interface LocateResult {
  itemCode: string
  itemName: string
  uom: string
  total: number
  bins: BinLocation[]
  pallets?: Pallet[] // pallet ids for stocked items, attached by the locate route
  hasBatch?: boolean // false = non-serialized (quantity) item -> quantity-mode controls
}
interface ItemOption {
  itemCode: string
  itemName: string
}
// One release LINE of an open order — what the add-pallet dropdown offers. The
// dashboard line number is the floor's unique handle (Simon 2026-07-20).
interface SoLineOption {
  so: string
  soItem: string
  customer: string
  deliveryDate: string | null
  dashboardLine: number | null
}
interface BinContentItem {
  itemCode: string
  itemName: string
  uom: string
  qty: number
  pallets: { batch: string; qty: number }[]
}
interface StagingSoLine {
  soItem: string // Sales Order Item child name — the reservation target
  deliveryDate: string | null
  orderedQty: number
  reservedQty: number
  reservable: boolean // staging targets only; add flow also lists non-reservable lines
  dashboardLine: number | null // the floor's unique release handle (packing-sheet line number)
}
interface StagingSalesOrder {
  name: string
  customer: string
  poNo: string | null
  orderedQty: number
  reservedQty: number
  deliveryDate: string | null
  stagingStatus: string | null
  lines: StagingSoLine[]
}
interface InventoryRow {
  itemCode: string
  itemName: string
  uom: string
  warehouse: string
  qty: number
  pallets: { batch: string; qty: number }[]
}
interface PalletLookup {
  batch: string
  itemCode: string
  itemName: string
  warehouse: string
  qty: number
  split: boolean
  superseded: boolean
  scanned: string
}
interface RemovedPallet {
  batch: string
  itemCode: string
  itemName: string
  labelQty: number // the quantity that was printed on the label
  lastWarehouse: string | null
  uom: string
  // What ended the pallet (best-effort from the logs): shipped on a DN,
  // removed by a person, or just zeroed.
  terminal?: {
    kind: 'shipped' | 'removed' | 'zeroed'
    at: string | null
    by: string | null
    dn?: string | null
    so?: string | null
    customer?: string | null
  }
}
interface RecentLabel {
  batch: string | null
  itemCode: string
  printer: string | null
  printerLocation: string | null
  purpose: string | null
  warehouse: string | null // bin/area the label was allocated to
  qty: number | null // op quantity: pieces for serialized pallets, BOXES for non-serialized
  piecesPerPack: number // pieces per box (1 unless set) — for the non-serialized part total
  weightLb: number | null // pallet weight/dims when captured at print (Simon 2026-07-03)
  dims: string | null
  by: string
  at: string | null
  status: string | null
  claimedAt: string | null
  printedAt: string | null
  error: string | null
}
interface DeletedLabel {
  batch: string
  itemCode: string
  itemName: string | null
  uom: string
  qty: number | null // the label quantity (what was printed on the pallet)
  warehouse: string | null // last bin it was in (restore target prefill)
  weightLb: number | null // pallet weight/dims when captured at print
  dims: string | null
  by: string
  at: string | null
  restored: boolean // a later restore already returned it — disable re-restoring (would double stock)
}
interface Station {
  id: string
  name: string
  location?: string | null
}

// Max search results we auto-load pallet rows for (sorted by stock). Bounds the lazy
// pallet fan-out on broad searches; the server already seeds the top items inline.
const LAZY_PALLET_LIMIT = 24
interface HistEvent {
  action: string
  at: string | null
  by: string
  qty: number | null
  warehouse: string | null
}

// Roles allowed to DELETE/restore inventory (destructive ops). Advanced Users were
// granted the same delete capability as managers (Simon 2026-06-25).
const OFFICE_ROLES = ['admin', 'super_admin', 'manager', 'shipping_manager', 'advanced_user', 'shipping_team']

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
      case 'restore':
        text = `${t('inventoryOps.histRestored')}${e.qty != null ? ` · ${e.qty} ${t('inventoryOps.units')}` : ''}${e.warehouse ? ` · ${e.warehouse}` : ''}`
        break
      // From the fulfillment log — the "warehouse" slot carries "DN · SO".
      case 'shipped':
        text = `${t('inventoryOps.histShipped')}${e.warehouse ? ` · ${e.warehouse}` : ''}`
        break
      case 'unshipped':
        text = `${t('inventoryOps.histUnshipped')}${e.warehouse ? ` · ${e.warehouse}` : ''}`
        break
      case 'stage-reserve':
        text = `${t('inventoryOps.histStaged')}${e.warehouse ? ` · ${e.warehouse}` : ''}`
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

// On an exact pallet scan, show only the bin that holds the matched pallet (so other
// bins don't look stocked with no pallet under them).
function visibleBins(r: LocateResult, matched: string | null): BinLocation[] {
  if (!matched) return r.bins
  return r.bins.filter((b) => (r.pallets ?? []).some((p) => p.batch === matched && p.warehouse === b.warehouse))
}

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

  // Stable idempotency keys per (action, pallet): a timeout+retry of the SAME action
  // on the SAME pallet reuses the key so the server dedupes it (no double adjust/move/
  // remove/reprint). Cleared only on success, so the next deliberate action is fresh.
  const opKeysRef = useRef<Record<string, string>>({})
  // Key is bound to action + pallet + the PAYLOAD, so retrying the SAME action with
  // the SAME values reuses the key (server dedupes), but changing a value (e.g. a
  // different qty/destination) mints a fresh key — never silently dedupes a different
  // request against the first one.
  const opKey = (action: string, batch: string, payload: unknown = '') => {
    const k = `${action}:${batch}:${JSON.stringify(payload)}`
    if (!opKeysRef.current[k]) opKeysRef.current[k] = uuid()
    return opKeysRef.current[k]
  }
  const clearOpKey = (action: string, batch: string, payload: unknown = '') => {
    delete opKeysRef.current[`${action}:${batch}:${JSON.stringify(payload)}`]
  }

  // Send the verified Supabase session token; the server derives identity from it
  // so the recorded "who" can't be spoofed. Caller headers are spread FIRST so they
  // can't strip the Authorization. If a request 401s (token expired / hydration lag),
  // refresh the session once and retry so a logged-in user isn't blocked.
  const authedFetch = useCallback(async (url: string, opts: RequestInit = {}) => {
    const run = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      return fetch(url, {
        ...opts,
        headers: {
          ...(opts.headers ?? {}),
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
    }
    let res = await run()
    if (res.status === 401) {
      await supabase.auth.refreshSession().catch(() => {})
      res = await run()
    }
    return res
  }, [])

  // ─── reference data ───
  const [warehouses, setWarehouses] = useState<string[]>([])
  const [defaultWarehouse, setDefaultWarehouse] = useState('')
  const [stations, setStations] = useState<Station[]>([])
  const [defaultStationId, setDefaultStationId] = useState<string | null>(null)

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
      .then((d) => {
        setStations(d.stations ?? [])
        setDefaultStationId(d.defaultStationId ?? null)
      })
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
  const [superseded, setSuperseded] = useState<{ scanned: string; current: string | null } | null>(null)
  // A scanned pallet whose stock was removed/zeroed: shown at 0 with its data + a restore form.
  const [removedPallet, setRemovedPallet] = useState<RemovedPallet | null>(null)
  const [restoreQty, setRestoreQty] = useState('')
  const [restoreBin, setRestoreBin] = useState('') // committed destination bin for restore
  const [restoring, setRestoring] = useState(false)
  // Quantity-mode (non-serialized items): the open per-bin transfer/remove panel + inputs.
  const [qtyOp, setQtyOp] = useState<{ itemCode: string; fromWarehouse: string; mode: 'transfer' | 'remove' } | null>(null)
  const [qtyAmount, setQtyAmount] = useState('')
  const [qtyDestBin, setQtyDestBin] = useState('') // committed destination bin (transfer)
  const [qtyBusy, setQtyBusy] = useState(false)

  const runSearch = useCallback(
    async (q: string, signal: AbortSignal) => {
      if (q.trim().length < 2) {
        setResults([])
        setSearched(false)
        setMatchedPallet(null)
        setSuperseded(null)
        setRemovedPallet(null)
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
        setSuperseded(data.superseded ?? null)
        const rp: RemovedPallet | null = data.removedPallet ?? null
        setRemovedPallet(rp)
        if (rp) {
          // Prefill the restore form: full label qty, back to its last known bin.
          setRestoreQty(String(rp.labelQty))
          setRestoreBin(rp.lastWarehouse ?? '')
        }
        // Seed the pallet lists from the inline pallet ids (no refetch needed); the rows
        // render inline under each bin (no expander).
        const seeded: Record<string, Pallet[]> = {}
        for (const r of rows) if (r.pallets) seeded[r.itemCode] = r.pallets
        if (Object.keys(seeded).length) setPallets((p) => ({ ...p, ...seeded }))
        setSearched(true)
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        setSearchError(t('inventoryOps.error'))
        setResults([])
        setMatchedPallet(null)
        setSuperseded(null)
        setRemovedPallet(null)
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

  // Deep link: /inventory-ops?q=<pallet or part> (the pallet sections on the
  // order rows link here). window.location avoids the useSearchParams Suspense
  // requirement on this already-huge client page.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuery(q.trim().toUpperCase())
  }, [])

  // ─── By-item part-number picker (focus the search to browse/select all parts) ───
  const [itemPickerOpen, setItemPickerOpen] = useState(false)
  const [allItems, setAllItems] = useState<ItemOption[]>([])
  const [allItemsLoading, setAllItemsLoading] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openItemPicker = useCallback(() => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current) // cancel a pending close
    setItemPickerOpen(true)
  }, [])

  // Part picker results: search the catalog SERVER-side as the user types. The old
  // approach loaded EVERY item up front (limit_page_length=0) then filtered in the
  // browser, which took 10-20s on a large catalog before anything showed. Now a typed
  // query hits the indexed search (?q=, capped) and returns in ~1s. Debounced.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setAllItems([]); setAllItemsLoading(false); return }
    const c = new AbortController()
    const id = setTimeout(async () => {
      setAllItemsLoading(true)
      try {
        const r = await authedFetch(`/api/erpnext/inventory/items?q=${encodeURIComponent(q)}`, { signal: c.signal })
        const d = await r.json()
        setAllItems(d.items ?? [])
      } catch {
        /* ignore (incl. abort on the next keystroke) */
      } finally {
        setAllItemsLoading(false)
      }
    }, 250)
    return () => { clearTimeout(id); c.abort() }
  }, [query, authedFetch])

  // ─── pallets (per item) ───
  const [pallets, setPallets] = useState<Record<string, Pallet[]>>({})
  // Live SO reservations keyed by batch. `null` = checked, not reserved (so the effect
  // below doesn't re-query it); a value renders the "Reserved → SO" badge on the pallet.
  const [reservations, setReservations] = useState<Record<string, BatchReservation | null>>({})
  const [palletsLoading, setPalletsLoading] = useState<string | null>(null)
  const [palletsError, setPalletsError] = useState<Record<string, boolean>>({})
  // Tracks item codes whose pallet load is in flight. `palletsLoading` is a single
  // scalar (only good for the spinner); this ref dedupes CONCURRENT loads so the
  // lazy-load effect can't re-trigger an in-flight fetch for the same item.
  const palletReqRef = useRef<Set<string>>(new Set())

  const loadPallets = useCallback(
    async (itemCode: string) => {
      palletReqRef.current.add(itemCode)
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
        palletReqRef.current.delete(itemCode)
        setPalletsLoading(null)
      }
    },
    [authedFetch]
  )

  // Pallets render inline under each bin. The search seeds pallet ids for the first N
  // stocked items (locate's enrich cap); for any stocked item beyond that, lazy-load its
  // pallets once so its rows + actions still appear without an expander/click. The ref
  // guard prevents duplicate concurrent fetches; pallets[code] becoming defined (incl.
  // [] on error) prevents re-fetching after completion. We only auto-load the TOP
  // LAZY_PALLET_LIMIT results (sorted by stock) so a broad search can't fan out dozens of
  // /pallets calls at once — beyond that the user narrows the search to act on a pallet.
  useEffect(() => {
    for (const r of results.slice(0, LAZY_PALLET_LIMIT)) {
      // Non-serialized items have no pallets — quantity mode renders bins directly.
      if (r.hasBatch === false) continue
      if (r.total > 0 && pallets[r.itemCode] === undefined && !palletReqRef.current.has(r.itemCode) && !palletsError[r.itemCode]) {
        loadPallets(r.itemCode)
      }
    }
  }, [results, pallets, palletsError, loadPallets])

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
  // durationMs: critical errors the operator must act on (e.g. label printed but the
  // sales-order attach failed) stay up longer than the default toast.
  const showFlash = (kind: 'ok' | 'err', msg: string, durationMs = 5000) => {
    setFlash({ kind, msg })
    if (flashRef.current) clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setFlash(null), durationMs)
  }

  // ─── Confirmation dialog (delete + reprint) ───
  // A misclick on the trash or reprint icon is costly: delete pulls stock and reprint voids the
  // current label. Both now route through this promise-based modal so the worker must confirm.
  // `withReason` shows an optional reason box (used by the two delete paths, replacing the old
  // window.prompt). Resolves { ok, reason } so callers `if (!ok) return` and keep their flow.
  type ConfirmReq = {
    title: string
    message: string
    detail?: string // emphasized line, e.g. the pallet id or qty·bin being acted on
    confirmLabel: string
    danger?: boolean // red confirm button (delete) vs amber (reprint)
    withReason?: boolean
    reasonLabel?: string
    // Printer picker inside the dialog (reprint): the label goes wherever the
    // OPERATOR says, not wherever it originally printed — a pallet made in one
    // area often gets fixed in another (Simon 2026-07-20). Options are the
    // user's allowed stations; the pick comes back in resolve().
    stationPicker?: { label: string; initial: string }
    resolve: (v: { ok: boolean; reason: string; station: string }) => void
  }
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null)
  const [confirmReason, setConfirmReason] = useState('')
  const [confirmStation, setConfirmStation] = useState('')
  // Ref mirrors confirmReq so resolveConfirm can clear it synchronously (no double-resolve race)
  // and askConfirm can abandon an in-flight request if a second one opens (rapid double-click).
  const confirmReqRef = useRef<ConfirmReq | null>(null)
  const askConfirm = useCallback(
    (opts: Omit<ConfirmReq, 'resolve'>) =>
      new Promise<{ ok: boolean; reason: string; station: string }>((resolve) => {
        confirmReqRef.current?.resolve({ ok: false, reason: '', station: '' }) // abandon any pending request
        const req = { ...opts, resolve }
        confirmReqRef.current = req
        setConfirmReason('')
        setConfirmStation(opts.stationPicker?.initial ?? '')
        setConfirmReq(req)
      }),
    []
  )
  const resolveConfirm = (ok: boolean) => {
    const req = confirmReqRef.current
    if (!req) return
    confirmReqRef.current = null
    req.resolve({ ok, reason: confirmReason.trim(), station: confirmStation })
    setConfirmReq(null)
    setConfirmReason('')
    setConfirmStation('')
  }
  // Keyboard: Escape cancels; Enter confirms the reprint dialog (the delete dialog's reason
  // input owns its own Enter so typing a reason and hitting Enter submits there).
  useEffect(() => {
    if (!confirmReq) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolveConfirm(false)
      else if (e.key === 'Enter' && !confirmReq.withReason) resolveConfirm(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmReq])
  const refreshSearch = useCallback(() => {
    const c = new AbortController()
    runSearch(query, c.signal)
  }, [query, runSearch])

  // ─── Locations view (browse by bin) ───
  const [viewMode, setViewMode] = useState<'item' | 'bin' | 'transfer' | 'stage'>('item')
  const [binQuery, setBinQuery] = useState('')
  const [binOpen, setBinOpen] = useState(false)
  const [selectedBin, setSelectedBin] = useState<string | null>(null)
  const [binContents, setBinContents] = useState<{ items: BinContentItem[]; total: number; palletsTruncated: boolean } | null>(null)
  const [binLoading, setBinLoading] = useState(false)
  const [binError, setBinError] = useState(false)

  // Latest requested bin — guards against a slow earlier fetch resolving last and
  // overwriting the current bin's contents (no AbortController on this endpoint).
  const binReqRef = useRef<string>('')
  const loadBin = useCallback(
    async (wh: string) => {
      binReqRef.current = wh
      setSelectedBin(wh)
      setBinQuery(wh)
      setBinOpen(false)
      setBinLoading(true)
      setBinError(false)
      setBinContents(null)
      try {
        const r = await authedFetch(`/api/erpnext/inventory/bin-contents?warehouse=${encodeURIComponent(wh)}`)
        if (!r.ok) throw new Error('bin lookup failed')
        const d = await r.json()
        if (binReqRef.current !== wh) return // a newer bin selection superseded this one
        setBinContents({ items: d.items ?? [], total: d.total ?? 0, palletsTruncated: !!d.palletsTruncated })
      } catch {
        if (binReqRef.current === wh) setBinError(true)
      } finally {
        if (binReqRef.current === wh) setBinLoading(false)
      }
    },
    [authedFetch]
  )

  // After a write action, refresh whichever view is showing: the Locations bin (so a
  // transferred/removed pallet leaves it) or the search results + that item's pallet rows.
  const refreshAfterMutation = useCallback(
    (itemCode: string) => {
      if (viewMode === 'bin') {
        if (selectedBin) loadBin(selectedBin)
      } else {
        refreshSearch()
        loadPallets(itemCode)
      }
    },
    [viewMode, selectedBin, loadBin, refreshSearch, loadPallets]
  )

  // ─── Recently printed labels (so a jammed/failed print can be found + reprinted) ───
  const [recentLabels, setRecentLabels] = useState<RecentLabel[]>([])
  const [recentLoading, setRecentLoading] = useState(false)
  const [recentExpanded, setRecentExpanded] = useState(false)
  const loadRecentLabels = useCallback(
    async (expanded: boolean) => {
      setRecentLoading(true)
      try {
        const r = await authedFetch(`/api/erpnext/inventory/recent-labels?limit=${expanded ? 50 : 10}`)
        if (!r.ok) throw new Error('recent labels failed')
        const d = await r.json()
        setRecentLabels(d.labels ?? [])
      } catch {
        /* leave prior list; non-critical panel */
      } finally {
        setRecentLoading(false)
      }
    },
    [authedFetch]
  )
  useEffect(() => {
    loadRecentLabels(false)
  }, [loadRecentLabels])

  // Look up SO reservations for a set of pallet batches (live from ERPNext) and merge
  // them into the map. Records `null` for batches with no reservation so we don't refetch.
  const loadReservations = useCallback(
    async (batches: string[]) => {
      const want = Array.from(new Set(batches.filter(Boolean)))
      if (want.length === 0) return
      try {
        const qs = want.map((b) => encodeURIComponent(b)).join(',')
        const r = await authedFetch(`/api/erpnext/inventory/reservations?batches=${qs}`)
        if (!r.ok) return
        const d = await r.json()
        const found: Record<string, BatchReservation> = d.reservations ?? {}
        setReservations((prev) => {
          const next = { ...prev }
          for (const b of want) next[b] = found[b] ?? null
          return next
        })
      } catch {
        /* non-critical badge — leave unresolved */
      }
    },
    [authedFetch]
  )

  // Whenever the visible pallet set changes (a new search, a bin load, a post-mutation
  // pallet refresh, or the recent-labels refresh), re-fetch reservations for exactly the
  // batches on screen so a released/added reservation reflects on the next refresh — the
  // badge stays live rather than only accumulating. Deliberately NOT keyed on
  // `reservations` (it's this effect's own output) so there is no refetch loop.
  useEffect(() => {
    const batches: string[] = []
    for (const arr of Object.values(pallets)) for (const p of arr) batches.push(p.batch)
    if (binContents) for (const it of binContents.items) for (const p of it.pallets) batches.push(p.batch)
    for (const l of recentLabels) if (l.batch) batches.push(l.batch)
    if (batches.length) loadReservations(batches)
  }, [pallets, binContents, recentLabels, loadReservations])

  // ─── Recently deleted labels (a deleted-by-mistake pallet, returned to inventory in one
  //     click — same label if the same qty, a new label if it changed) ───
  const [deletedLabels, setDeletedLabels] = useState<DeletedLabel[]>([])
  const [deletedLoading, setDeletedLoading] = useState(false)
  const [deletedExpanded, setDeletedExpanded] = useState(false)
  const [delRow, setDelRow] = useState<string | null>(null) // batch whose restore form is open
  const [delQty, setDelQty] = useState('')
  const [delBin, setDelBin] = useState('')
  const [delRestoring, setDelRestoring] = useState(false)
  const loadDeletedLabels = useCallback(
    async (expanded: boolean) => {
      setDeletedLoading(true)
      try {
        const r = await authedFetch(`/api/erpnext/inventory/recent-deletions?limit=${expanded ? 50 : 10}`)
        if (!r.ok) throw new Error('recent deletions failed')
        const d = await r.json()
        setDeletedLabels(d.deletions ?? [])
      } catch {
        /* leave prior list; non-critical panel */
      } finally {
        setDeletedLoading(false)
      }
    },
    [authedFetch]
  )
  useEffect(() => {
    loadDeletedLabels(false)
  }, [loadDeletedLabels])

  // ─── Bulk transfer (scan-to-queue → one atomic Material Transfer) ───
  const [destBin, setDestBin] = useState('')
  const [transferQueue, setTransferQueue] = useState<PalletLookup[]>([])
  const [scanInput, setScanInput] = useState('')
  const [queueBusy, setQueueBusy] = useState(false)
  const [transferScanOpen, setTransferScanOpen] = useState(false)
  const [posting, setPosting] = useState(false)
  const [lastTransfer, setLastTransfer] = useState<{ destination: string; count: number; by: string; at: string | null } | null>(null)
  // Suppress the scanner re-firing the same code while a label lingers in frame (it decodes
  // ~every 150ms), so continuous scanning adds each distinct pallet once.
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  const loadLastTransfer = useCallback(async () => {
    try {
      const r = await authedFetch('/api/erpnext/inventory/last-transfer')
      if (!r.ok) return
      const d = await r.json()
      setLastTransfer(d.last ?? null)
    } catch {
      /* non-critical */
    }
  }, [authedFetch])

  // Resolve a scanned/typed pallet code and add it to the queue (deduped; skips a pallet
  // already in the destination, a split pallet, or an unknown code, with a flash).
  const addToQueue = async (rawCode: string) => {
    const code = rawCode.trim()
    if (!code || queueBusy) return
    setQueueBusy(true)
    try {
      const r = await authedFetch(`/api/erpnext/inventory/pallet-lookup?code=${encodeURIComponent(code)}`)
      const d = await r.json()
      const p: PalletLookup | null = d.pallet ?? null
      if (!p) {
        showFlash('err', `${code}: ${t('inventoryOps.transferNotFound')}`)
        return
      }
      if (p.split) {
        showFlash('err', `${p.batch}: ${t('inventoryOps.transferSplit')}`)
        return
      }
      if (destBin && p.warehouse === destBin) {
        showFlash('err', `${p.batch} ${t('inventoryOps.transferAlreadyHere')}`)
        return
      }
      if (transferQueue.some((x) => x.batch === p.batch)) {
        showFlash('ok', `${p.batch} ${t('inventoryOps.transferAlreadyQueued')}`)
        return
      }
      // Functional update with its OWN dedup guard too, in case rapid scans raced past the
      // closure check above.
      setTransferQueue((q) => (q.some((x) => x.batch === p.batch) ? q : [...q, p]))
      setScanInput('')
    } catch {
      showFlash('err', t('inventoryOps.error'))
    } finally {
      setQueueBusy(false)
    }
  }

  const postTransfer = async () => {
    if (!destBin || transferQueue.length === 0 || posting || busyRef.current) return
    busyRef.current = true
    setPosting(true)
    const batches = transferQueue.map((p) => p.batch).sort()
    const key = opKey('bulk-transfer', destBin, batches)
    try {
      const r = await authedFetch('/api/erpnext/inventory/bulk-transfer', {
        method: 'POST',
        body: JSON.stringify({
          destination: destBin,
          lines: transferQueue.map((p) => ({ batch: p.batch, itemCode: p.itemCode })),
          idempotencyKey: key,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'transfer failed')
      clearOpKey('bulk-transfer', destBin, batches)
      // `moved` is only present on the fresh post; on a duplicate/resume show a generic
      // confirmation rather than overstating the count.
      const skipped = Array.isArray(d.skipped) ? d.skipped.length : 0
      showFlash(
        'ok',
        typeof d.moved === 'number'
          ? `${t('inventoryOps.transferPosted')} ${d.moved} → ${destBin}${skipped ? ` · ${skipped} ${t('inventoryOps.transferSkipped')}` : ''}`
          : `${t('inventoryOps.transferPosted')} → ${destBin}`
      )
      setTransferQueue([])
      loadLastTransfer()
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setPosting(false)
      busyRef.current = false
    }
  }

  // ─── Prepare for staging (scan pallets → reserve them to an open Sales Order) ───
  // The queue is constrained to ONE item (you reserve pallets of a single part to an SO line),
  // so the open-orders lookup is filtered by that item. Mirrors the Transfer tab's scan-to-queue.
  // Queue items carry the pallet's EXISTING reservation (if any) so a pallet
  // locked to another order can be MOVED — release + re-reserve on confirm
  // (Simon 2026-07-03: emergency order needs a pallet staged for a later one).
  type StageQueueItem = PalletLookup & {
    reservedTo?: { so: string; soItem: string | null; line: number | null; customer: string | null; sre: string | null }
  }
  const [stageQueue, setStageQueue] = useState<StageQueueItem[]>([])
  const [stageScanInput, setStageScanInput] = useState('')
  const [stageQueueBusy, setStageQueueBusy] = useState(false)
  const [stageScanOpen, setStageScanOpen] = useState(false)
  const [stageOrders, setStageOrders] = useState<StagingSalesOrder[]>([])
  const [stageOrdersLoading, setStageOrdersLoading] = useState(false)
  const [selectedSo, setSelectedSo] = useState<string>('')
  // The picked release LINE (SO Item child name) — operators pick a line, not an
  // order; the line number is the floor's unique handle (Simon 2026-07-20).
  const [selectedSoItem, setSelectedSoItem] = useState<string>('')
  const [staging, setStaging] = useState(false)
  const lastStageScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  const stageItemCode = stageQueue[0]?.itemCode ?? ''
  const stageQueuePcs = stageQueue.reduce((s, p) => s + p.qty, 0)

  // Open Sales Orders for the queued item — so the operator picks the order to reserve against.
  const loadStageOrders = useCallback(
    async (itemCode: string) => {
      if (!itemCode) {
        setStageOrders([])
        return
      }
      setStageOrdersLoading(true)
      try {
        const r = await authedFetch(`/api/erpnext/staging/orders?itemCode=${encodeURIComponent(itemCode)}`)
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'lookup failed')
        setStageOrders(d.salesOrders ?? [])
      } catch {
        setStageOrders([])
        showFlash('err', t('inventoryOps.error'))
      } finally {
        setStageOrdersLoading(false)
      }
    },
    [authedFetch, t]
  )

  // Reload orders whenever the queued item changes (first scan sets it, clearing resets it).
  useEffect(() => {
    if (!stageItemCode) {
      setStageOrders([])
      setSelectedSo('')
      setSelectedSoItem('')
      return
    }
    loadStageOrders(stageItemCode)
  }, [stageItemCode, loadStageOrders])

  // Resolve a scanned/typed pallet code and add it to the staging queue. Rejects an unknown
  // code, a split pallet, a duplicate, or a pallet of a DIFFERENT item than the queue holds
  // (one order line takes one part).
  const addToStageQueue = async (rawCode: string) => {
    const code = rawCode.trim()
    if (!code || stageQueueBusy) return
    setStageQueueBusy(true)
    try {
      const r = await authedFetch(`/api/erpnext/inventory/pallet-lookup?code=${encodeURIComponent(code)}`)
      const d = await r.json()
      const p: PalletLookup | null = d.pallet ?? null
      if (!p) {
        showFlash('err', `${code}: ${t('inventoryOps.transferNotFound')}`)
        return
      }
      if (p.split) {
        showFlash('err', `${p.batch}: ${t('inventoryOps.transferSplit')}`)
        return
      }
      if (stageQueue.length > 0 && p.itemCode !== stageQueue[0].itemCode) {
        showFlash('err', `${p.batch}: ${t('inventoryOps.stageDifferentItem')}`)
        return
      }
      if (stageQueue.some((x) => x.batch === p.batch)) {
        showFlash('ok', `${p.batch} ${t('inventoryOps.transferAlreadyQueued')}`)
        return
      }
      // Already reserved to an order? Queue it flagged for a MOVE (amber row +
      // explicit confirmation at post time) instead of failing at ERPNext.
      let reservedTo:
        | { so: string; soItem: string | null; line: number | null; customer: string | null; sre: string | null }
        | undefined
      try {
        const rr = await authedFetch(`/api/erpnext/inventory/reservations?batches=${encodeURIComponent(p.batch)}`)
        if (rr.ok) {
          const rd = await rr.json()
          const res = rd.reservations?.[p.batch]
          if (res)
            reservedTo = {
              so: res.so,
              soItem: res.soItem ?? null,
              line: res.dashboardLine ?? null,
              customer: res.customer ?? null,
              sre: res.sre ?? null,
            }
        }
      } catch {
        /* reservation lookup is advisory — the server re-checks at post time */
      }
      setStageQueue((q) => (q.some((x) => x.batch === p.batch) ? q : [...q, { ...p, reservedTo }]))
      setStageScanInput('')
    } catch {
      showFlash('err', t('inventoryOps.error'))
    } finally {
      setStageQueueBusy(false)
    }
  }

  const postStage = async () => {
    if (!selectedSo || !selectedSoItem || stageQueue.length === 0 || staging || busyRef.current) return
    // Moves need an explicit operator confirmation listing what leaves which
    // order — and a printer, because a moved pallet is RELABELED (new code +
    // fresh label with the new order; the old label stops scanning).
    // A move is a reservation to another ORDER — or to another LINE of the same
    // order (line-level restage relabels too, so the printed line never lies).
    // MUST match the server's conflict rule exactly, including soItem null
    // (unknown line ownership = move) — a mismatch loops the operator into
    // 409s with no confirm dialog (gemini/codex round-3).
    const moves = stageQueue.filter(
      (p) => p.reservedTo && (p.reservedTo.so !== selectedSo || p.reservedTo.soItem !== selectedSoItem)
    )
    if (moves.length > 0) {
      if (!addStation) {
        showFlash('err', t('inventoryOps.stageMoveNeedsPrinter'))
        return
      }
      const stationName = stations.find((s) => s.id === addStation)?.name ?? addStation
      // Name the SOURCE line being released — a same-order line move must not
      // read like a no-op in the confirm dialog (codex round-4).
      const list = moves
        .map((m) => {
          const src =
            m.reservedTo!.line != null
              ? `${t('inventoryOps.stageLine')} ${m.reservedTo!.line} (${m.reservedTo!.so})`
              : m.reservedTo!.so
          return `${m.batch} — ${src}${m.reservedTo!.customer ? ` (${m.reservedTo!.customer})` : ''}`
        })
        .join('\n')
      if (
        !window.confirm(
          `${t('inventoryOps.stageMoveConfirm')}\n\n${list}\n\n${t('inventoryOps.stageMoveRelabel').replace('{printer}', stationName)}`
        )
      )
        return
    }
    busyRef.current = true
    setStaging(true)
    const batches = stageQueue.map((p) => p.batch).sort()
    // The target LINE is part of the op identity — the same queue aimed at a
    // different line must mint a new idempotency key, not replay the old op.
    const key = opKey('stage-reserve', `${selectedSo}:${selectedSoItem}`, batches)
    try {
      const r = await authedFetch('/api/erpnext/staging/assign', {
        method: 'POST',
        body: JSON.stringify({
          soName: selectedSo,
          salesOrderItem: selectedSoItem,
          // sre = the reservation SHOWN to the operator (the one the move
          // confirmation named) — the server refuses to release anything else.
          pallets: stageQueue.map((p) => ({
            batch: p.batch,
            itemCode: p.itemCode,
            warehouse: p.warehouse,
            qty: p.qty,
            sre: p.reservedTo?.sre ?? undefined,
          })),
          allowMove: moves.length > 0,
          station: moves.length > 0 ? addStation : undefined,
          idempotencyKey: key,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'staging failed')
      clearOpKey('stage-reserve', `${selectedSo}:${selectedSoItem}`, batches)
      const reserved = typeof d.reserved === 'number' ? d.reserved : stageQueue.length
      const relabels = (d.relabels ?? []) as { oldBatch: string; newBatch: string }[]
      const relabelNote = relabels.length
        ? ` · ${t('inventoryOps.stageRelabeled')} ${relabels.map((x) => `${x.oldBatch}→${x.newBatch}`).join(', ')}`
        : ''
      // Confirm with the LINE number when we have it — that's the handle the
      // floor works by; the SO name is the fallback for unmapped lines.
      const selLine = stageOrders.flatMap((o) => o.lines).find((l) => l.soItem === selectedSoItem)
      const selLabel =
        selLine?.dashboardLine != null ? `${t('inventoryOps.stageLine')} ${selLine.dashboardLine}` : selectedSo
      showFlash(
        'ok',
        (d.staged
          ? `${t('inventoryOps.stageStaged')} ${selLabel}`
          : `${t('inventoryOps.stageReserved')} ${reserved} → ${selLabel}`) + relabelNote
      )
      // Clearing the queue hides the orders panel and (via the item effect) resets selection.
      setStageQueue([])
      setSelectedSo('')
      setSelectedSoItem('')
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setStaging(false)
      busyRef.current = false
    }
  }

  // Toggle By item / By bin / Transfer. RELOADS the view we switch INTO so it never shows
  // data that went stale from a mutation in another view, and closes any open edit/move/
  // history panel (those are single-value states shared across views).
  const switchView = (mode: 'item' | 'bin' | 'transfer' | 'stage') => {
    setViewMode(mode)
    setEditBatch(null)
    setMovingBatch(null)
    setHistoryOpen(null)
    if (mode === 'bin') {
      if (selectedBin) loadBin(selectedBin)
    } else if (mode === 'transfer') {
      loadLastTransfer()
    } else if (mode === 'stage') {
      // Nothing to preload — orders load once the first pallet is scanned (they filter by item).
    } else if (query) {
      refreshSearch()
    }
  }

  // ─── bin report export (PDF + CSV) ───
  const triggerDownload = (filename: string, mime: string, content: string | Blob) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  const safeName = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '_')
  // CSV cell: guard against spreadsheet formula injection (a value starting with = + - @
  // or a control char is prefixed with a quote), then RFC-4180 quote if needed.
  const csvCell = (v: string) => {
    const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
  }
  const stampNow = () =>
    new Date().toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true })

  const downloadBinCsv = () => {
    if (!binContents || !selectedBin) return
    const rows: string[][] = [[t('inventoryOps.repBin'), t('inventoryOps.repItemCode'), t('inventoryOps.repItemName'), t('inventoryOps.repUom'), t('inventoryOps.repQty'), t('inventoryOps.repPallets')]]
    for (const it of binContents.items) {
      rows.push([
        selectedBin,
        it.itemCode,
        it.itemName,
        it.uom,
        String(it.qty),
        it.pallets.map((p) => `${p.batch} (${p.qty})`).join(' | '),
      ])
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
    triggerDownload(`bin-${safeName(selectedBin)}-${Date.now()}.csv`, 'text/csv;charset=utf-8', '﻿' + csv)
  }

  const downloadBinPdf = async () => {
    if (!binContents || !selectedBin) return
    const { default: JsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new JsPDF()
    doc.setFontSize(14)
    doc.text(`${t('inventoryOps.repBinTitle')} — ${selectedBin}`, 14, 16)
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(`${t('inventoryOps.repTotalOnHand')}: ${binContents.total.toLocaleString()}   ·   ${t('inventoryOps.repGenerated')} ${stampNow()}`, 14, 22)
    doc.setTextColor(0)
    autoTable(doc, {
      startY: 27,
      head: [[t('inventoryOps.repItemCode'), t('inventoryOps.repItemName'), t('inventoryOps.repQty'), t('inventoryOps.repPallets')]],
      body: binContents.items.map((it) => [
        it.itemCode,
        it.itemName,
        `${it.qty.toLocaleString()} ${it.uom}`.trim(),
        it.pallets.map((p) => `${p.batch} (${p.qty})`).join('\n'),
      ]),
      styles: { fontSize: 8, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: [43, 108, 176] },
      columnStyles: { 0: { cellWidth: 32, font: 'courier' }, 2: { cellWidth: 24 }, 3: { font: 'courier', fontSize: 7 } },
    })
    doc.save(`bin-${safeName(selectedBin)}-${Date.now()}.pdf`)
  }

  // ─── full inventory export (.xlsx, By Bin + By Product tabs) ───
  const [fullReportLoading, setFullReportLoading] = useState(false)
  const downloadFullInventory = async () => {
    if (fullReportLoading) return
    setFullReportLoading(true)
    try {
      const r = await authedFetch('/api/erpnext/inventory/report')
      if (!r.ok) throw new Error('report failed')
      const d = await r.json()
      const rows: InventoryRow[] = d.rows ?? []
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Entech Dashboard'
      wb.created = new Date()

      const styleHeader = (ws: import('exceljs').Worksheet) => {
        const h = ws.getRow(1)
        h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6CB0' } }
        ws.views = [{ state: 'frozen', ySplit: 1 }]
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: ws.columnCount } }
      }

      const palletStr = (x: InventoryRow) => x.pallets.map((p) => `${p.batch} (${p.qty})`).join(', ')

      // Tab 1 — By Bin: pick a bin from the Bin column's filter dropdown.
      const byBin = wb.addWorksheet(t('inventoryOps.repTabByBin'))
      byBin.columns = [
        { header: t('inventoryOps.repBin'), key: 'warehouse', width: 28 },
        { header: t('inventoryOps.repItemCode'), key: 'itemCode', width: 20 },
        { header: t('inventoryOps.repItemName'), key: 'itemName', width: 44 },
        { header: t('inventoryOps.repUom'), key: 'uom', width: 10 },
        { header: t('inventoryOps.repQty'), key: 'qty', width: 12 },
        { header: t('inventoryOps.repPallets'), key: 'pallets', width: 50 },
      ]
      ;[...rows]
        .sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.itemName.localeCompare(b.itemName))
        .forEach((x) => byBin.addRow({ ...x, pallets: palletStr(x) }))
      styleHeader(byBin)

      // Tab 2 — By Product: pick a product from the Item filter dropdown.
      const byProd = wb.addWorksheet(t('inventoryOps.repTabByProduct'))
      byProd.columns = [
        { header: t('inventoryOps.repItemCode'), key: 'itemCode', width: 20 },
        { header: t('inventoryOps.repItemName'), key: 'itemName', width: 44 },
        { header: t('inventoryOps.repBin'), key: 'warehouse', width: 28 },
        { header: t('inventoryOps.repUom'), key: 'uom', width: 10 },
        { header: t('inventoryOps.repQty'), key: 'qty', width: 12 },
        { header: t('inventoryOps.repPallets'), key: 'pallets', width: 50 },
      ]
      ;[...rows]
        .sort((a, b) => a.itemName.localeCompare(b.itemName) || a.warehouse.localeCompare(b.warehouse))
        .forEach((x) => byProd.addRow({ ...x, pallets: palletStr(x) }))
      styleHeader(byProd)

      const buf = await wb.xlsx.writeBuffer()
      triggerDownload(
        `inventory-${Date.now()}.xlsx`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        new Blob([buf])
      )
    } catch {
      showFlash('err', t('inventoryOps.error'))
    } finally {
      setFullReportLoading(false)
    }
  }

  // ─── single-product report (from a search result card) ───
  const productBreakdown = (r: LocateResult) => {
    const pals = pallets[r.itemCode] ?? []
    return r.bins.map((b) => ({
      bin: b.warehouse,
      qty: b.qty,
      pallets: pals.filter((p) => p.warehouse === b.warehouse).map((p) => ({ batch: p.batch, qty: p.qty })),
    }))
  }
  const downloadProductCsv = (r: LocateResult) => {
    const rows: string[][] = [[t('inventoryOps.repItemCode'), t('inventoryOps.repItemName'), t('inventoryOps.repUom'), t('inventoryOps.repBin'), t('inventoryOps.repQty'), t('inventoryOps.repPallets')]]
    for (const b of productBreakdown(r)) {
      rows.push([r.itemCode, r.itemName, r.uom, b.bin, String(b.qty), b.pallets.map((p) => `${p.batch} (${p.qty})`).join(' | ')])
    }
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
    triggerDownload(`product-${safeName(r.itemCode)}-${Date.now()}.csv`, 'text/csv;charset=utf-8', '﻿' + csv)
  }
  const downloadProductPdf = async (r: LocateResult) => {
    const { default: JsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new JsPDF()
    doc.setFontSize(14)
    doc.text(`${t('inventoryOps.repProductTitle')} — ${r.itemCode}`, 14, 16)
    doc.setFontSize(10)
    doc.text(r.itemName, 14, 22)
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(`${t('inventoryOps.repTotalOnHand')}: ${r.total.toLocaleString()} ${r.uom}   ·   ${t('inventoryOps.repGenerated')} ${stampNow()}`, 14, 28)
    doc.setTextColor(0)
    autoTable(doc, {
      startY: 33,
      head: [[t('inventoryOps.repBin'), t('inventoryOps.repQty'), t('inventoryOps.repPallets')]],
      body: productBreakdown(r).map((b) => [
        b.bin,
        `${b.qty.toLocaleString()} ${r.uom}`.trim(),
        b.pallets.map((p) => `${p.batch} (${p.qty})`).join('\n'),
      ]),
      styles: { fontSize: 8, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: [43, 108, 176] },
      columnStyles: { 1: { cellWidth: 26 }, 2: { font: 'courier', fontSize: 7 } },
    })
    doc.save(`product-${safeName(r.itemCode)}-${Date.now()}.pdf`)
  }

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
  const [addWarehouse, setAddWarehouse] = useState('') // committed bin selection (BinCombobox)
  const [addStation, setAddStation] = useState('')
  const [adding, setAdding] = useState(false)
  // Optional pallet weight (lb) + dimensions — stored on the Batch, printed on
  // the label (Simon 2026-07-03). Dimensions are THREE separate numeric boxes
  // (L/W/H) so the stored format is always identical ("48x40x60") no matter
  // who types it — freeform invited xX/space/format drift (Simon 2026-07-03).
  const [addWeight, setAddWeight] = useState('')
  const [addDimL, setAddDimL] = useState('')
  const [addDimW, setAddDimW] = useState('')
  const [addDimH, setAddDimH] = useState('')
  // Release line to attach to the label (optional). The operator picks a LINE —
  // shown by its dashboard line number, the floor's unique handle — not an SO
  // (Simon 2026-07-20). The list is filtered server-side to the open lines that
  // actually include the selected part, so the dropdown stays short.
  const [salesOrder, setSalesOrder] = useState('') // committed SO name ('' = none)
  const [salesOrderItem, setSalesOrderItem] = useState('') // committed SO Item (release line)
  const [salesOrderLineNo, setSalesOrderLineNo] = useState<number | null>(null) // committed line's display number
  const [soOptions, setSoOptions] = useState<SoLineOption[]>([])
  const [soLoading, setSoLoading] = useState(false)
  const [soQuery, setSoQuery] = useState('') // typed filter text
  const [soOpen, setSoOpen] = useState(false)

  // When the part changes, reset + reload the matching open release lines.
  useEffect(() => {
    setSalesOrder('')
    setSalesOrderItem('')
    setSalesOrderLineNo(null)
    setSoQuery('')
    setSoOpen(false)
    setSoOptions([])
    if (!addItem) return
    let cancelled = false
    setSoLoading(true)
    authedFetch(`/api/erpnext/staging/orders?itemCode=${encodeURIComponent(addItem.itemCode)}`)
      .then((r) => (r.ok ? r.json() : { salesOrders: [] }))
      .then((d) => {
        if (cancelled) return
        const orders = (d.salesOrders ?? []) as StagingSalesOrder[]
        const lines: SoLineOption[] = orders
          .flatMap((o) =>
            o.lines.map((l) => ({
              so: o.name,
              soItem: l.soItem,
              customer: o.customer,
              deliveryDate: l.deliveryDate,
              dashboardLine: l.dashboardLine,
            }))
          )
          .sort(
            (a, b) =>
              (a.deliveryDate ?? '9999-12-31').localeCompare(b.deliveryDate ?? '9999-12-31') || a.soItem.localeCompare(b.soItem)
          )
        setSoOptions(lines)
      })
      .catch(() => {
        if (!cancelled) setSoOptions([])
      })
      .finally(() => {
        if (!cancelled) setSoLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [addItem, authedFetch])

  useEffect(() => {
    if (defaultWarehouse) setAddWarehouse((w) => w || defaultWarehouse)
  }, [defaultWarehouse])
  useEffect(() => {
    if (addStation || stations.length === 0) return
    // Pre-select the user's default printer if they have one (and it's in their
    // allowed list); otherwise fall back to the first station.
    const preferred =
      defaultStationId && stations.some((s) => s.id === defaultStationId)
        ? defaultStationId
        : stations[0].id
    setAddStation(preferred)
  }, [stations, addStation, defaultStationId])

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
    // Dimensions: all three or none (a partial LxWxH would print garbage).
    const dimVals = [addDimL, addDimW, addDimH].map((v) => v.trim())
    const dimsFilled = dimVals.filter((v) => v !== '').length
    if (dimsFilled > 0 && (dimsFilled < 3 || dimVals.some((v) => !(Number(v) > 0)))) {
      showFlash('err', t('inventoryOps.dimsIncomplete'))
      return
    }
    const dims = dimsFilled === 3 ? dimVals.map((v) => String(Number(v))).join('x') : undefined
    // Labels attached to a sales order are finished product going to a customer:
    // weight + dimensions are REQUIRED for them (Simon 2026-07-03).
    if (salesOrder && (!(Number(addWeight) > 0) || !dims)) {
      showFlash('err', t('inventoryOps.weightDimsRequired'))
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
          salesOrder: salesOrder || undefined,
          salesOrderItem: salesOrderItem || undefined,
          weightLb: Number(addWeight) > 0 ? Number(addWeight) : undefined,
          dims,
          idempotencyKey: addKeyRef.current,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        // Non-serialized label cap — show the bilingual message, not a raw server string.
        if (d.code === 'max_labels') {
          showFlash('err', t('inventoryOps.maxLabels').replace('{max}', String(d.max ?? 10)))
          return
        }
        throw new Error(d.error || 'add failed')
      }
      addKeyRef.current = null // success -> next add gets a fresh key
      const addedItemCode = addItem.itemCode
      // The server attaches the pallet to the picked SO BEFORE printing; if the attach
      // failed, the label printed WITHOUT the order — that must be a loud, long-lived
      // error, not a green toast (silent-attach-failure incident, pallet DQ0N 2026-07-16).
      const staging = d.staging as
        | { attached?: boolean; warning?: string; informational?: boolean }
        | undefined
      // Fail CLOSED: when an SO was picked, anything short of an explicit attached:true
      // is treated as an attach failure — a false alarm is recoverable, a false success
      // was the DQ0N incident. The one exception is the server saying `informational`:
      // non-serialized items have no reservation concept, their SO is label text only.
      // (Client and API deploy atomically on Vercel, so the server always speaks this
      // contract by the time this code runs.)
      if (salesOrder && staging?.attached !== true && staging?.informational !== true) {
        showFlash(
          'err',
          t('inventoryOps.soAttachFailed')
            .replace('{batch}', String(d.batch ?? ''))
            .replace('{so}', salesOrder) +
            (d.labelPending ? ` (${t('inventoryOps.labelPending')})` : '') +
            (staging?.warning ? ` — ${staging.warning}` : ''),
          20000
        )
      } else if (salesOrder && staging?.attached === true && d.labelPending) {
        // Attached, but the physical label may not match (stale queued ZPL, or a
        // replayed op whose original label content can't be verified) — the fix is a
        // Reprint, said loudly rather than as a green-toast footnote (codex round 4).
        showFlash(
          'err',
          t('inventoryOps.labelStale')
            .replace('{batch}', String(d.batch ?? ''))
            .replace('{so}', salesOrder),
          20000
        )
      } else {
        const attachedNote =
          salesOrder && staging?.attached ? ` — ${t('inventoryOps.soAttached').replace('{so}', salesOrder)}` : ''
        showFlash('ok', `${t('inventoryOps.added')} ${d.batch}${attachedNote}${d.labelPending ? ` (${t('inventoryOps.labelPending')})` : ''}`)
      }
      setAddItem(null)
      setItemQuery('')
      setAddQty('')
      setAddWeight('')
      setAddDimL('')
      setAddDimW('')
      setAddDimH('')
      setAddOpen(false)
      // Refresh the active search so the new pallet appears: bins/totals via the search,
      // and the item's pallet rows directly (covers an already-cached item outside
      // locate's inline enrich cap, which the lazy-load effect would otherwise skip).
      if (query) refreshSearch()
      loadPallets(addedItemCode)
      loadRecentLabels(recentExpanded) // a new label was printed
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
  // Where the ADJUSTED label prints — the operator picks (a pallet made in one
  // area often gets fixed in another; Simon 2026-07-20). Seeded from the user's
  // default printer when the edit opens.
  const [editStation, setEditStation] = useState('')
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
        body: JSON.stringify({
          batch,
          itemCode,
          newQty: qty,
          station: editStation || defaultStationId || addStation || stations[0]?.id,
          idempotencyKey: opKey('adjust', batch, qty),
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'adjust failed')
      clearOpKey('adjust', batch, qty)
      const serial = (d.batch as string) ?? batch
      // A qty change reissues the pallet as a new serial; follow it so the exact-pallet
      // view keeps showing the live pallet rather than the now-disabled old code.
      showFlash('ok', `${t('inventoryOps.adjusted')} ${batch} -> ${qty}${serial !== batch ? ` (${serial})` : ''}`)
      setEditBatch(null)
      setMatchedPallet((mp) => (mp === batch ? serial : mp))
      setHistoryOpen((h) => (h === batch ? null : h)) // old serial gone after reissue
      refreshAfterMutation(itemCode)
      loadRecentLabels(recentExpanded) // a new label was printed
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setBusyBatch(null)
      busyRef.current = false
    }
  }

  const submitRemove = async (itemCode: string, batch: string) => {
    // Confirm first — deleting pulls stock out of inventory. The reason is OPTIONAL: confirming
    // with a blank box still removes; only Cancel aborts. A typed reason is still recorded.
    const { ok, reason } = await askConfirm({
      title: t('inventoryOps.confirmDeleteTitle'),
      message: t('inventoryOps.confirmDeleteMsg'),
      detail: batch,
      confirmLabel: t('inventoryOps.confirmDeleteBtn'),
      danger: true,
      withReason: true,
      reasonLabel: t('inventoryOps.removeReason'),
    })
    if (!ok) return
    const cleanReason = reason.trim()
    if (busyRef.current) return
    busyRef.current = true
    setBusyBatch(batch)
    try {
      const r = await authedFetch('/api/erpnext/inventory/remove', {
        method: 'POST',
        body: JSON.stringify({ batch, itemCode, reason: cleanReason, idempotencyKey: opKey('remove', batch, cleanReason) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'remove failed')
      clearOpKey('remove', batch, cleanReason)
      showFlash('ok', `${t('inventoryOps.removed')} ${batch}`)
      setHistoryOpen((h) => (h === batch ? null : h)) // removed pallet's row unmounts
      loadDeletedLabels(deletedExpanded) // a new deletion to show in the recently-deleted log
      refreshAfterMutation(itemCode)
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
        body: JSON.stringify({ batch, itemCode, toWarehouse: moveWarehouse, idempotencyKey: opKey('move', batch, moveWarehouse) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'move failed')
      clearOpKey('move', batch, moveWarehouse)
      showFlash('ok', `${t('inventoryOps.moved')} ${batch} -> ${moveWarehouse}`)
      setMovingBatch(null)
      setMoveWarehouse('')
      setMoveWhFilter('')
      refreshAfterMutation(itemCode)
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
    const initialStation = defaultStationId || addStation || stations[0]?.id
    if (!initialStation) {
      showFlash('err', t('inventoryOps.addMissing'))
      return
    }
    // Confirm first — a reprint voids the current label and issues a new pallet code, so the old
    // printed label must be discarded. Guards against an accidental tap on the reprint icon.
    // The dialog also picks the PRINTER: the new label goes wherever the operator
    // is, not wherever the original printed (Simon 2026-07-20).
    const { ok, station } = await askConfirm({
      title: t('inventoryOps.confirmReprintTitle'),
      message: t('inventoryOps.confirmReprintMsg'),
      detail: batch,
      confirmLabel: t('inventoryOps.confirmReprintBtn'),
      stationPicker: { label: t('inventoryOps.printAt'), initial: initialStation },
    })
    if (!ok) return
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
        body: JSON.stringify({ batch, itemCode, station, idempotencyKey: opKey('reprint', batch, station) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'reprint failed')
      clearOpKey('reprint', batch, station)
      const serial = (d.batch as string) ?? batch
      // A reprint reissues the pallet as a new serial (old label is voided); follow it.
      // 2xx is NOT blanket success: the reservation may have failed to move to the new
      // serial (pallet silently un-staged), or the new label may not have printed
      // (labelPending) — both need a loud, long-lived error (codex review round 4).
      const reprintStaging = d.staging as
        | { attached?: boolean; warning?: string; reason?: string }
        | undefined
      if (reprintStaging?.attached === false) {
        // 'transfer_failed' = the server KNOWS the reservation didn't move (strong
        // message); anything else = it couldn't be verified — could be a never-staged
        // pallet's replay, so the wording is conditional (round-6 consensus). A label
        // failure on top must not be masked by this branch (codex round-6).
        const detachMsg =
          reprintStaging.reason === 'transfer_failed'
            ? t('inventoryOps.reprintDetached').replace('{batch}', serial)
            : t('inventoryOps.reprintCheckStaging').replace('{batch}', serial)
        showFlash(
          'err',
          detachMsg + (d.labelPending ? ` ${t('inventoryOps.labelPendingReprint').replace('{batch}', serial)}` : ''),
          20000
        )
      } else if (d.labelPending) {
        showFlash('err', t('inventoryOps.labelPendingReprint').replace('{batch}', serial), 20000)
      } else {
        showFlash('ok', `${t('inventoryOps.reprinted')} ${serial !== batch ? `${batch} -> ${serial}` : batch}`)
      }
      setMatchedPallet((mp) => (mp === batch ? serial : mp))
      refreshAfterMutation(itemCode)
      loadRecentLabels(recentExpanded) // a new label was printed
      // The old serial is gone after a reissue — drop its cached/open history.
      if (historyOpen === batch) {
        setHistoryOpen(null)
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

  // Shared restore call: re-receipt a removed pallet's stock. Same qty as the label keeps the
  // same serial (no new label); a different qty reissues a new serial + prints a new label.
  // Returns the (possibly new) serial + whether a new label was printed; throws on failure.
  // Callers own validation, the new-label confirm, busy state, the flash, and list refresh.
  const doRestore = async (p: { batch: string; itemCode: string; labelQty: number }, qty: number, bin: string) => {
    const willReissue = qty !== p.labelQty
    const station = addStation || stations[0]?.id
    if (willReissue && !station) throw new Error(t('inventoryOps.addMissing'))
    const payload = `${qty}:${bin}`
    const r = await authedFetch('/api/erpnext/inventory/restore', {
      method: 'POST',
      body: JSON.stringify({ batch: p.batch, itemCode: p.itemCode, qty, warehouse: bin, station, idempotencyKey: opKey('restore', p.batch, payload) }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'restore failed')
    clearOpKey('restore', p.batch, payload)
    return { serial: (d.batch as string) ?? p.batch, newLabel: !!d.newLabel }
  }

  // Return a removed/zeroed pallet's stock to inventory (scan path). A different qty reissues
  // a new serial + prints a new label (we confirm with the user first).
  const submitRestore = async () => {
    if (!removedPallet) return
    const qty = Number(restoreQty)
    if (!(qty > 0)) {
      showFlash('err', t('inventoryOps.restoreQtyInvalid'))
      return
    }
    const bin = restoreBin.trim()
    if (!bin) {
      showFlash('err', t('inventoryOps.restoreBinRequired'))
      return
    }
    if (qty !== removedPallet.labelQty && !window.confirm(t('inventoryOps.restoreNewLabelConfirm'))) return
    if (busyRef.current) return
    busyRef.current = true
    setRestoring(true)
    try {
      const { serial, newLabel } = await doRestore(removedPallet, qty, bin)
      showFlash('ok', newLabel ? `${t('inventoryOps.restoredNew')} ${serial}` : `${t('inventoryOps.restored')} ${serial}`)
      if (newLabel) loadRecentLabels(recentExpanded)
      loadDeletedLabels(deletedExpanded) // this deletion is now undone
      // Re-run the search on the (possibly new) serial so it now shows as stocked.
      setRemovedPallet(null)
      setQuery(serial)
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setRestoring(false)
      busyRef.current = false
    }
  }

  // Return a deleted pallet to inventory from the Recently-deleted-labels panel (its inline
  // Edit/restore form). Same qty -> the original label still works; a different qty reprints.
  const submitDeletedRestore = async (row: DeletedLabel) => {
    const qty = Number(delQty)
    if (!(qty > 0)) {
      showFlash('err', t('inventoryOps.restoreQtyInvalid'))
      return
    }
    const bin = delBin.trim()
    if (!bin) {
      showFlash('err', t('inventoryOps.restoreBinRequired'))
      return
    }
    // labelQty unknown (legacy row) -> treat any entry as a reprint so we never silently reuse
    // a label for a quantity we couldn't verify.
    const labelQty = row.qty ?? -1
    if (qty !== labelQty && !window.confirm(t('inventoryOps.restoreNewLabelConfirm'))) return
    if (busyRef.current) return
    busyRef.current = true
    setDelRestoring(true)
    try {
      const { serial, newLabel } = await doRestore({ batch: row.batch, itemCode: row.itemCode, labelQty }, qty, bin)
      showFlash('ok', newLabel ? `${t('inventoryOps.restoredNew')} ${serial}` : `${t('inventoryOps.restored')} ${serial}`)
      if (newLabel) loadRecentLabels(recentExpanded)
      setDelRow(null)
      loadDeletedLabels(deletedExpanded)
      refreshAfterMutation(row.itemCode) // the item's main results now reflect the returned stock
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setDelRestoring(false)
      busyRef.current = false
    }
  }

  // Open a deleted row's inline restore form, prefilled with its label qty + last bin.
  const openDeletedRestore = (row: DeletedLabel) => {
    if (busyRef.current) return // don't switch rows mid-restore (would close the active form)
    if (delRow === row.batch) {
      setDelRow(null)
      return
    }
    setDelRow(row.batch)
    setDelQty(row.qty != null ? String(row.qty) : '')
    setDelBin(row.warehouse ?? '')
  }

  // ─── Quantity mode (non-serialized items): move/remove a quantity (boxes) per bin ───
  const submitQtyTransfer = async (itemCode: string, fromWarehouse: string) => {
    const qty = Number(qtyAmount)
    const dest = qtyDestBin.trim()
    if (!(qty > 0)) {
      showFlash('err', t('inventoryOps.restoreQtyInvalid'))
      return
    }
    if (!dest) {
      showFlash('err', t('inventoryOps.qtyDestRequired'))
      return
    }
    if (dest === fromWarehouse) {
      showFlash('err', t('inventoryOps.qtySameBin'))
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setQtyBusy(true)
    const payload = `${qty}:${fromWarehouse}:${dest}`
    try {
      const r = await authedFetch('/api/erpnext/inventory/qty-transfer', {
        method: 'POST',
        body: JSON.stringify({ itemCode, qty, fromWarehouse, toWarehouse: dest, idempotencyKey: opKey('qty-transfer', itemCode, payload) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'transfer failed')
      clearOpKey('qty-transfer', itemCode, payload)
      showFlash('ok', `${t('inventoryOps.moved')} ${qty} · ${fromWarehouse} → ${dest}`)
      setQtyOp(null)
      setQtyAmount('')
      setQtyDestBin('')
      refreshAfterMutation(itemCode)
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setQtyBusy(false)
      busyRef.current = false
    }
  }

  const submitQtyRemove = async (itemCode: string, fromWarehouse: string) => {
    const qty = Number(qtyAmount)
    if (!(qty > 0)) {
      showFlash('err', t('inventoryOps.restoreQtyInvalid'))
      return
    }
    // Confirm first — this pulls boxes out of inventory. Reason is optional (confirming with a
    // blank box still removes); only Cancel aborts.
    const { ok, reason } = await askConfirm({
      title: t('inventoryOps.confirmDeleteTitle'),
      message: t('inventoryOps.confirmDeleteMsg'),
      detail: `${qty} · ${fromWarehouse}`,
      confirmLabel: t('inventoryOps.confirmDeleteBtn'),
      danger: true,
      withReason: true,
      reasonLabel: t('inventoryOps.removeReason'),
    })
    if (!ok) return
    const cleanReason = reason.trim()
    if (busyRef.current) return
    busyRef.current = true
    setQtyBusy(true)
    const payload = `${qty}:${fromWarehouse}:${cleanReason}`
    try {
      const r = await authedFetch('/api/erpnext/inventory/qty-remove', {
        method: 'POST',
        body: JSON.stringify({ itemCode, qty, warehouse: fromWarehouse, reason: cleanReason, idempotencyKey: opKey('qty-remove', itemCode, payload) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'remove failed')
      clearOpKey('qty-remove', itemCode, payload)
      showFlash('ok', `${t('inventoryOps.removed')} ${qty} · ${fromWarehouse}`)
      setQtyOp(null)
      setQtyAmount('')
      refreshAfterMutation(itemCode)
    } catch (e) {
      showFlash('err', (e as Error).message)
    } finally {
      setQtyBusy(false)
      busyRef.current = false
    }
  }

  // Non-serialized item body: each bin with its box count + per-bin Transfer / Remove (qty).
  const renderQtyMode = (r: LocateResult) => (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{t('inventoryOps.qtyModeHint')}</div>
      {r.bins.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t('inventoryOps.noStock')}</div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {r.bins.map((b) => {
            const open = qtyOp && qtyOp.itemCode === r.itemCode && qtyOp.fromWarehouse === b.warehouse
            const toggle = (mode: 'transfer' | 'remove') => {
              const same = open && qtyOp.mode === mode
              setQtyOp(same ? null : { itemCode: r.itemCode, fromWarehouse: b.warehouse, mode })
              setQtyAmount('')
              setQtyDestBin('')
            }
            return (
              <li key={b.warehouse} className="px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {b.warehouse}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{b.qty.toLocaleString()}</span>
                    <button
                      onClick={() => toggle('transfer')}
                      title={t('inventoryOps.move')}
                      className={`hover:text-foreground ${open && qtyOp.mode === 'transfer' ? 'text-primary' : 'text-muted-foreground'}`}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                    </button>
                    {/* Delete follows PRINT permission (any allowed printer),
                        not office role — group leaders who print labels also
                        fix mistakes (Simon 2026-07-20). Restore stays office. */}
                    {(isOffice || stations.length > 0) && (
                      <button
                        onClick={() => toggle('remove')}
                        title={t('inventoryOps.remove')}
                        className={`hover:text-red-600 ${open && qtyOp.mode === 'remove' ? 'text-red-600' : 'text-muted-foreground'}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {open && qtyOp.mode === 'transfer' && (
                  <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2">
                    <div className="text-xs font-medium">{t('inventoryOps.qtyTransferTitle')}</div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="sm:w-28">
                        <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.qtyBoxes')}</label>
                        <input
                          type="number"
                          min="1"
                          max={b.qty}
                          value={qtyAmount}
                          onChange={(e) => setQtyAmount(e.target.value)}
                          className="w-full rounded border border-border bg-background px-2 py-2 text-sm"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.moveTo')}</label>
                        <BinCombobox
                          value={qtyDestBin}
                          onChange={setQtyDestBin}
                          warehouses={warehouses.filter((w) => w !== b.warehouse)}
                          placeholder={t('inventoryOps.searchBin')}
                          noBinsLabel={t('inventoryOps.noBins')}
                        />
                      </div>
                      <button
                        onClick={() => submitQtyTransfer(r.itemCode, b.warehouse)}
                        disabled={qtyBusy || !(Number(qtyAmount) > 0) || !qtyDestBin}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {qtyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
                        {t('inventoryOps.moveConfirm')}
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t('inventoryOps.qtyAvail')}: {b.qty.toLocaleString()}</div>
                  </div>
                )}

                {open && qtyOp.mode === 'remove' && (
                  <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-2">
                    <div className="text-xs font-medium">{t('inventoryOps.qtyRemoveTitle')}</div>
                    <div className="flex items-end gap-2">
                      <div className="w-28">
                        <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.qtyBoxes')}</label>
                        <input
                          type="number"
                          min="1"
                          max={b.qty}
                          value={qtyAmount}
                          onChange={(e) => setQtyAmount(e.target.value)}
                          className="w-full rounded border border-border bg-background px-2 py-2 text-sm"
                        />
                      </div>
                      <button
                        onClick={() => submitQtyRemove(r.itemCode, b.warehouse)}
                        disabled={qtyBusy || !(Number(qtyAmount) > 0)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {qtyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        {t('inventoryOps.remove')}
                      </button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t('inventoryOps.qtyAvail')}: {b.qty.toLocaleString()}</div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  if (!canAccess('/inventory-ops')) {
    return <div className="p-8 text-sm text-muted-foreground">{t('inventoryOps.noAccess')}</div>
  }

  const filteredMoveWarehouses = moveWhFilter
    ? warehouses.filter((w) => w.toLowerCase().includes(moveWhFilter.toLowerCase())).slice(0, 50)
    : warehouses.slice(0, 50)

  // Parts shown in the By-item picker: all parts, filtered by whatever's typed in the
  // search box (matches code or name). Rendered list is capped for DOM sanity; if more
  // match, a hint tells the user to keep typing (we never silently hide matches).
  // allItems is already the server-side search result for the current query.
  const PART_PICKER_CAP = 500
  const filteredParts = allItems.slice(0, PART_PICKER_CAP)
  const partsTruncated = allItems.length > filteredParts.length

  // Recent-labels helpers: map the op action to a friendly purpose, and the print-job
  // status to a label + color (so a jam/failure stands out).
  const PURPOSE_KEY: Record<string, string> = { add: 'added', adjust: 'adjusted', reprint: 'reprinted', remove: 'removed', move: 'moved', restore: 'restored' }
  const purposeText = (a: string) => (PURPOSE_KEY[a] ? t(`inventoryOps.${PURPOSE_KEY[a]}`) : a)
  // Normalize the print-agent's status (vocabularies vary) and flag a job that hasn't
  // printed within a few minutes as STUCK — the agent normally prints within seconds, so a
  // lingering pending/claimed job means a jam / offline printer (Simon's case).
  const STUCK_MS = 3 * 60 * 1000
  const labelStatus = (l: RecentLabel) => {
    const s = (l.status ?? '').toLowerCase()
    if (s === 'printed' || s === 'done') return { text: t('inventoryOps.statusPrinted'), cls: 'text-green-600' }
    if (s === 'error' || s === 'failed') return { text: t('inventoryOps.statusFailed'), cls: 'font-medium text-red-600' }
    // Not yet printed (pending/queued/claimed/printing): flag if it's been too long.
    const ageMs = l.at ? Date.now() - new Date(l.at).getTime() : 0
    if (ageMs > STUCK_MS) return { text: t('inventoryOps.statusStuck'), cls: 'font-medium text-red-600' }
    if (s === 'claimed' || s === 'printing') return { text: t('inventoryOps.statusPrinting'), cls: 'text-blue-600' }
    return { text: t('inventoryOps.statusQueued'), cls: 'text-amber-600' }
  }

  // One actionable pallet row (id + qty + history/move/reprint/edit/remove + inline
  // edit/move/history panels). Shared by the By-item search results AND the By-bin
  // Locations view so both have identical capabilities. `warehouse` is the pallet's
  // current bin (used to exclude it from the Move target list).
  const renderPalletRow = (
    p: { batch: string; warehouse: string; qty: number; weightLb?: number; dims?: string; printedAt?: string | null },
    itemCode: string
  ) => (
    <li key={p.batch} className="px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className={matchedPallet === p.batch ? 'font-semibold text-primary' : ''}>{p.batch}</span>
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
            <select
              value={editStation}
              onChange={(e) => setEditStation(e.target.value)}
              title={t('inventoryOps.printAt')}
              aria-label={t('inventoryOps.printAt')}
              className="max-w-32 rounded border border-border bg-background px-1.5 py-1 text-xs"
            >
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => submitAdjust(itemCode, p.batch)}
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
          <div className="flex shrink-0 items-center gap-2.5">
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
              onClick={() => submitReprint(itemCode, p.batch)}
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
                setEditStation(defaultStationId || addStation || stations[0]?.id || '')
              }}
              title={t('inventoryOps.editQty')}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {/* Delete follows PRINT permission (Simon 2026-07-20) — see the
                qty-remove gate above; restore remains office-only. */}
            {(isOffice || stations.length > 0) && (
              <button
                onClick={() => submitRemove(itemCode, p.batch)}
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

      {(p.weightLb || p.dims || p.printedAt) && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {p.weightLb ? `${p.weightLb.toLocaleString()} lb` : ''}
          {p.weightLb && p.dims ? ' · ' : ''}
          {p.dims ? `${p.dims} in` : ''}
          {(p.weightLb || p.dims) && p.printedAt ? ' · ' : ''}
          {p.printedAt ? `${t('inventoryOps.printedAtLabel')} ${p.printedAt}` : ''}
        </div>
      )}

      {reservations[p.batch] && (
        <div className="mt-1">
          <span
            title={`${t('inventoryOps.reservedTo')} ${reservations[p.batch]!.so}${reservations[p.batch]!.poNo ? ` · PO ${reservations[p.batch]!.poNo}` : ''} · ${reservations[p.batch]!.reservedQty.toLocaleString()} · ${reservations[p.batch]!.status}`}
            className="inline-flex items-center gap-1 rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-300"
          >
            🔒 {t('inventoryOps.reservedTo')} {reservations[p.batch]!.so}
            {reservations[p.batch]!.customer ? ` · ${reservations[p.batch]!.customer}` : ''}
            {` · ${reservations[p.batch]!.reservedQty.toLocaleString()}`}
          </span>
        </div>
      )}

      {movingBatch === p.batch && (
        <div className="mt-2 rounded-md border border-border bg-background p-2">
          <div className="mb-1 text-xs font-medium">{t('inventoryOps.moveTo')}</div>
          <input
            value={moveWhFilter}
            onChange={(e) => {
              setMoveWhFilter(e.target.value)
              setMoveWarehouse('')
            }}
            placeholder={t('inventoryOps.searchBin')}
            autoFocus
            className="w-full rounded border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          {/* Type-ahead: matching bins appear as you type; tap to pick. */}
          <div data-lenis-prevent className="inv-scroll mt-1 max-h-44 overflow-y-auto overscroll-contain rounded border border-border" style={{ WebkitOverflowScrolling: 'touch' }}>
            {filteredMoveWarehouses.filter((w) => w !== p.warehouse).length === 0 ? (
              <div className="p-2 text-xs text-muted-foreground">{t('inventoryOps.noBins')}</div>
            ) : (
              filteredMoveWarehouses
                .filter((w) => w !== p.warehouse)
                .map((w) => (
                  <button
                    key={w}
                    onClick={() => {
                      setMoveWarehouse(w)
                      setMoveWhFilter(w)
                    }}
                    className={`block w-full px-2 py-2 text-left text-sm hover:bg-accent ${
                      moveWarehouse === w ? 'bg-primary/15 font-medium text-primary' : ''
                    }`}
                  >
                    {w}
                  </button>
                ))
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => submitMove(itemCode, p.batch)}
              disabled={!moveWarehouse || busyBatch === p.batch}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busyBatch === p.batch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5" />}
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
  )

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

      {/* Confirmation dialog — gates delete + reprint against accidental taps */}
      {confirmReq && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-msg"
          onClick={() => resolveConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className={`mt-0.5 h-5 w-5 shrink-0 ${confirmReq.danger ? 'text-red-600' : 'text-amber-600'}`}
              />
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-base font-semibold">{confirmReq.title}</h2>
                <p id="confirm-msg" className="mt-1 text-sm text-muted-foreground">{confirmReq.message}</p>
                {confirmReq.detail && (
                  <div className="mt-2 break-all font-mono text-sm font-medium">{confirmReq.detail}</div>
                )}
              </div>
            </div>
            {confirmReq.stationPicker && (
              <div className="mt-4">
                <label htmlFor="confirm-station" className="mb-1 block text-xs text-muted-foreground">
                  {confirmReq.stationPicker.label}
                </label>
                <select
                  id="confirm-station"
                  value={confirmStation}
                  onChange={(e) => setConfirmStation(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.location ? ` — ${s.location}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {confirmReq.withReason && (
              <div className="mt-4">
                <label htmlFor="confirm-reason" className="mb-1 block text-xs text-muted-foreground">{confirmReq.reasonLabel}</label>
                <input
                  id="confirm-reason"
                  type="text"
                  autoFocus
                  value={confirmReason}
                  onChange={(e) => setConfirmReason(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') resolveConfirm(true)
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => resolveConfirm(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                {t('inventoryOps.cancel')}
              </button>
              <button
                type="button"
                autoFocus={!confirmReq.withReason}
                onClick={() => resolveConfirm(true)}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                  confirmReq.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {confirmReq.confirmLabel}
              </button>
            </div>
          </div>
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
                  {/* Part number only — the description is often a duplicate / boilerplate. */}
                  <span className="font-mono">{addItem.itemCode}</span>
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
                        data-lenis-prevent
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
                            {/* Part number only (description is often a duplicate). */}
                            <span className="font-mono">{o.itemCode}</span>
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

            {/* Sales Order (optional) — only the OPEN SOs that include the selected part, so
                the dropdown stays short. Shown once a part is picked (the list is item-filtered). */}
            {addItem && (
              <div className="relative sm:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">
                  {t('inventoryOps.salesOrder')} <span className="font-normal text-muted-foreground/70">({t('inventoryOps.optional')})</span>
                </label>
                {salesOrder ? (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    <span className="font-mono">
                      {salesOrderLineNo != null ? `${t('inventoryOps.stageLine')} ${salesOrderLineNo}` : salesOrder}
                    </span>
                    <button
                      onClick={() => {
                        setSalesOrder('')
                        setSalesOrderItem('')
                        setSalesOrderLineNo(null)
                        // Deliberately NOT minting a new idempotency key here: if the
                        // prior add committed but its response was lost, a fresh key
                        // would receive the stock TWICE (codex round-4). A replayed
                        // key attaches from LIVE state and warns loudly on any line
                        // mismatch instead.
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={soQuery}
                      onChange={(e) => {
                        setSoQuery(e.target.value)
                        setSoOpen(true)
                      }}
                      onFocus={() => setSoOpen(true)}
                      onBlur={() => setTimeout(() => setSoOpen(false), 150)}
                      disabled={soLoading || soOptions.length === 0}
                      placeholder={
                        soLoading
                          ? t('inventoryOps.loading')
                          : soOptions.length === 0
                            ? t('inventoryOps.noSalesOrders')
                            : t('inventoryOps.searchSalesOrder')
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                    />
                    {soOpen && soOptions.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                        <div data-lenis-prevent className="inv-scroll max-h-60 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                          {soOptions
                            .filter(
                              (s) =>
                                !soQuery.trim() ||
                                String(s.dashboardLine ?? '').includes(soQuery.trim()) ||
                                s.so.toLowerCase().includes(soQuery.toLowerCase()) ||
                                (s.customer || '').toLowerCase().includes(soQuery.toLowerCase())
                            )
                            .map((s) => (
                              <button
                                key={s.soItem}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setSalesOrder(s.so)
                                  setSalesOrderItem(s.soItem)
                                  setSalesOrderLineNo(s.dashboardLine)
                                  setSoOpen(false)
                                  setSoQuery('')
                                  // Key kept on purpose — see the clear button's note
                                  // (a fresh key after a lost response double-receives).
                                }}
                                className="block w-full px-3 py-2.5 text-left text-sm hover:bg-accent"
                              >
                                <span className="font-mono">
                                  {s.dashboardLine != null ? `${t('inventoryOps.stageLine')} ${s.dashboardLine}` : s.so}
                                </span>
                                <span className="text-muted-foreground"> · {s.customer}</span>
                                {s.deliveryDate && <span className="text-xs text-muted-foreground"> · {s.deliveryDate}</span>}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

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
              <label className="mb-1 block text-xs text-muted-foreground">
                {salesOrder ? t('inventoryOps.palletWeightReq') : t('inventoryOps.palletWeight')}
                {salesOrder && <span className="text-red-500"> *</span>}
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={addWeight}
                onChange={(e) => setAddWeight(e.target.value)}
                placeholder={salesOrder ? undefined : t('inventoryOps.optional')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {salesOrder ? t('inventoryOps.palletDimsReq') : t('inventoryOps.palletDims')}
                {salesOrder && <span className="text-red-500"> *</span>}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={addDimL}
                  onChange={(e) => setAddDimL(e.target.value)}
                  placeholder={t('inventoryOps.dimL')}
                  aria-label={t('inventoryOps.dimL')}
                  className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={addDimW}
                  onChange={(e) => setAddDimW(e.target.value)}
                  placeholder={t('inventoryOps.dimW')}
                  aria-label={t('inventoryOps.dimW')}
                  className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={addDimH}
                  onChange={(e) => setAddDimH(e.target.value)}
                  placeholder={t('inventoryOps.dimH')}
                  aria-label={t('inventoryOps.dimH')}
                  className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
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
              <BinCombobox
                value={addWarehouse}
                onChange={setAddWarehouse}
                warehouses={warehouses}
                placeholder={t('inventoryOps.selectBin')}
                noBinsLabel={t('inventoryOps.noBins')}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={submitAdd}
              disabled={adding || !addItem || !addWarehouse || !addStation || !(Number(addQty) > 0)}
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

      {/* View toggle: search by item, or browse by bin (Locations) */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
          <button
            onClick={() => switchView('item')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${viewMode === 'item' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('inventoryOps.byItem')}
          </button>
          <button
            onClick={() => switchView('bin')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${viewMode === 'bin' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('inventoryOps.byBin')}
          </button>
          <button
            onClick={() => switchView('transfer')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${viewMode === 'transfer' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('inventoryOps.transferTab')}
          </button>
          <button
            onClick={() => switchView('stage')}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${viewMode === 'stage' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t('inventoryOps.stageTab')}
          </button>
        </div>
        <button
          onClick={downloadFullInventory}
          disabled={fullReportLoading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title={t('inventoryOps.fullReportHint')}
        >
          {fullReportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
          {t('inventoryOps.fullReport')}
        </button>
      </div>

      {viewMode === 'item' && (
      <>
      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!itemPickerOpen) openItemPicker()
          }}
          onFocus={openItemPicker}
          // Close shortly after losing focus so a click on an option still registers; the
          // timer is held in a ref and cancelled by openItemPicker on refocus.
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setItemPickerOpen(false), 150)
          }}
          placeholder={t('inventoryOps.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-20 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {itemPickerOpen && (
            <button
              type="button"
              onClick={() => { setQuery(''); setItemPickerOpen(false) }}
              aria-label={t('inventoryOps.cancel')}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
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

        {/* Part-number picker: focus the search to browse/select all parts (not pallet
            labels). Typing in the box filters this list AND runs the live search. */}
        {itemPickerOpen && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <div
              data-lenis-prevent
              className="inv-scroll max-h-80 overflow-y-auto overscroll-contain"
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
              {allItemsLoading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('inventoryOps.loading')}
                </div>
              ) : filteredParts.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">{t('inventoryOps.noResults')}</div>
              ) : (
                <>
                  {filteredParts.map((o) => (
                    <button
                      type="button"
                      key={o.itemCode}
                      onClick={() => {
                        setQuery(o.itemCode)
                        setItemPickerOpen(false)
                      }}
                      className="block w-full px-3 py-2.5 text-left text-sm hover:bg-accent"
                    >
                      {/* Part number only — the description is often a copy of the part
                          number (or boilerplate like "Molding finished part"), so showing
                          it just adds noise. We still match on name in the filter above. */}
                      <span className="font-mono">{o.itemCode}</span>
                    </button>
                  ))}
                  {partsTruncated && (
                    <div className="border-t border-border p-2 text-center text-[11px] text-muted-foreground">
                      {t('inventoryOps.partsTruncated')}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
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

      {/* Suppress the generic "scanned label is gone" banner when we have the richer
          removed-pallet card below (it explains the same thing and offers a restore). */}
      {superseded && !removedPallet && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('inventoryOps.supersededScan')} <span className="font-mono">{superseded.scanned}</span>.{' '}
            {superseded.current
              ? <>{t('inventoryOps.supersededCurrent')} <span className="font-mono font-semibold">{superseded.current}</span>.</>
              : t('inventoryOps.supersededGone')}
          </span>
        </div>
      )}

      {/* Removed/zeroed pallet: scanning a deleted pallet still shows its data at 0 and (for
          office roles) offers a one-click restore back to its last bin and label quantity. */}
      {removedPallet && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-2">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-sm font-semibold">{removedPallet.batch}</span>
                {removedPallet.terminal?.kind === 'shipped' ? (
                  <span className="rounded bg-blue-200 px-1.5 py-0.5 text-xs font-medium text-blue-900">
                    {t('inventoryOps.removedShipped')}
                  </span>
                ) : (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                    {t('inventoryOps.removedZero')}
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{removedPallet.itemCode}</div>
              <div className="mt-1 text-sm text-amber-900">
                {t('inventoryOps.removedLabelQty')}: <span className="font-semibold">{removedPallet.labelQty.toLocaleString()} {removedPallet.uom}</span>
                {removedPallet.lastWarehouse && (
                  <> · {t('inventoryOps.removedLastBin')}: <span className="font-medium">{removedPallet.lastWarehouse}</span></>
                )}
              </div>
              {removedPallet.terminal && removedPallet.terminal.kind !== 'zeroed' && (
                <div className="mt-1 text-xs text-amber-900">
                  {removedPallet.terminal.kind === 'shipped'
                    ? `${t('inventoryOps.terminalShipped')}${removedPallet.terminal.dn ? ` · ${removedPallet.terminal.dn}` : ''}${removedPallet.terminal.so ? ` · ${removedPallet.terminal.so}` : ''}${removedPallet.terminal.customer ? ` · ${removedPallet.terminal.customer}` : ''}`
                    : t('inventoryOps.terminalRemoved')}
                  {removedPallet.terminal.by ? ` · ${removedPallet.terminal.by}` : ''}
                  {removedPallet.terminal.at ? ` · ${new Date(removedPallet.terminal.at).toLocaleString()}` : ''}
                </div>
              )}
              <button
                onClick={() => toggleHistory(removedPallet.batch)}
                className={`mt-1 inline-flex items-center gap-1 text-xs hover:text-foreground ${historyOpen === removedPallet.batch ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <Clock className="h-3.5 w-3.5" /> {t('inventoryOps.history')}
              </button>

              {isOffice && removedPallet.terminal?.kind !== 'shipped' && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-background p-3">
                  <div className="mb-2 text-sm font-medium">{t('inventoryOps.restoreTitle')}</div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="sm:w-32">
                      <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.restoreQty')}</label>
                      <input
                        type="number"
                        min="1"
                        value={restoreQty}
                        onChange={(e) => setRestoreQty(e.target.value)}
                        className="w-full rounded border border-border bg-background px-2 py-2 text-sm"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.restoreBin')}</label>
                      <BinCombobox
                        value={restoreBin}
                        onChange={setRestoreBin}
                        warehouses={warehouses}
                        placeholder={t('inventoryOps.searchBin')}
                        noBinsLabel={t('inventoryOps.noBins')}
                      />
                    </div>
                    <button
                      onClick={submitRestore}
                      disabled={restoring || !(Number(restoreQty) > 0) || !restoreBin}
                      className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {restoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {t('inventoryOps.restoreConfirm')}
                    </button>
                  </div>
                  {Number(restoreQty) > 0 && Number(restoreQty) !== removedPallet.labelQty && (
                    <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {t('inventoryOps.restoreNewLabelNote')}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {historyOpen === removedPallet.batch && (
            <div className="mt-3 rounded-md border border-border bg-muted/30 p-2">
              {historyLoading === removedPallet.batch ? (
                <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('inventoryOps.loading')}
                </div>
              ) : (history[removedPallet.batch] ?? []).length === 0 ? (
                <div className="p-1 text-xs text-muted-foreground">{t('inventoryOps.noHistory')}</div>
              ) : (
                <ul className="space-y-1.5">
                  {describeEvents(history[removedPallet.batch] ?? [], t).map((ev, i) => (
                    <li key={i} className="text-xs">
                      <span className="text-foreground">{ev.text}</span>
                      <span className="text-muted-foreground"> · {ev.by}{ev.at ? ` · ${ev.at}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {results.map((r) => {
          // On an exact pallet scan, focus on THAT pallet: its own qty (not the part
          // family's total) and its bin.
          // Sum the matched pallet's qty across bins (a split batch has one row per bin),
          // so the header shows the pallet's true total, not just its first bin.
          const mpRows = matchedPallet ? (r.pallets ?? []).filter((p) => p.batch === matchedPallet) : []
          const mp = mpRows.length ? { qty: mpRows.reduce((s, p) => s + p.qty, 0) } : null
          return (
          <div key={r.itemCode} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                {/* Lead with the part number; show the name only when it adds info (often
                    the name duplicates the code or is boilerplate — that's just noise). */}
                <div className="font-mono font-medium">{r.itemCode}</div>
                {r.itemName && r.itemName !== r.itemCode && (
                  <div className="text-xs text-muted-foreground">{r.itemName}</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums">{(mp ? mp.qty : r.total).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.uom} {mp ? t('inventoryOps.inPallet') : t('inventoryOps.onHand')}
                  </div>
                </div>
                {!matchedPallet && r.total > 0 && pallets[r.itemCode] !== undefined && !palletsError[r.itemCode] && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => downloadProductCsv(r)}
                      title={`CSV — ${r.itemCode}`}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <FileSpreadsheet className="h-3 w-3" /> CSV
                    </button>
                    <button
                      onClick={() => downloadProductPdf(r)}
                      title={`PDF — ${r.itemCode}`}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <FileText className="h-3 w-3" /> PDF
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 border-t border-border pt-3">
              {r.hasBatch === false ? (
                renderQtyMode(r)
              ) : palletsError[r.itemCode] ? (
                <button
                  onClick={() => loadPallets(r.itemCode)}
                  className="flex items-center gap-2 p-1 text-xs text-red-600 hover:underline"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('inventoryOps.palletsError')}
                </button>
              ) : visibleBins(r, matchedPallet).length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  {matchedPallet ? t('inventoryOps.palletSuperseded') : t('inventoryOps.noStock')}
                </div>
              ) : (
                <ul className="space-y-3">
                  {visibleBins(r, matchedPallet).map((b, i) => {
                    // One row per pallet, with its actions inline — no separate "Manage
                    // pallets" expander (the pallet id is shown once, here).
                    const binPallets = (pallets[r.itemCode] ?? [])
                      .filter((p) => p.warehouse === b.warehouse)
                      // On an exact pallet scan, show ONLY that pallet (never its siblings).
                      .filter((p) => !matchedPallet || p.batch === matchedPallet)
                    return (
                      <li key={i} className="text-sm">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                            {b.warehouse}
                          </span>
                          <span className="font-medium tabular-nums">{b.qty.toLocaleString()}</span>
                        </div>
                        {binPallets.length === 0 ? (
                          palletsLoading === r.itemCode ? (
                            <div className="mt-1 flex items-center gap-1 pl-5 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {t('inventoryOps.loading')}
                            </div>
                          ) : null
                        ) : (
                          <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border bg-background">
                            {binPallets.map((p) => renderPalletRow(p, r.itemCode))}
                          </ul>
                          )}
                        </li>
                        )
                      })}
                    </ul>
                  )}
            </div>
          </div>
          )
        })}
      </div>
      </>
      )}

      {viewMode === 'bin' && (
      <>
        {/* Bin combo-box: type to filter or open the full list of bins */}
        <div className="relative mb-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={binQuery}
                onChange={(e) => {
                  setBinQuery(e.target.value)
                  setBinOpen(true)
                }}
                onFocus={() => setBinOpen(true)}
                placeholder={t('inventoryOps.selectBin')}
                className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              {binOpen && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                  <div data-lenis-prevent className="inv-scroll max-h-96 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {(binQuery.trim()
                      ? warehouses.filter((w) => w.toLowerCase().includes(binQuery.trim().toLowerCase()))
                      : warehouses
                    ).slice(0, 200).map((w) => (
                      <button
                        key={w}
                        onClick={() => loadBin(w)}
                        className={`block w-full px-3 py-2.5 text-left text-sm hover:bg-accent ${selectedBin === w ? 'bg-primary/15 font-medium text-primary' : ''}`}
                      >
                        {w}
                      </button>
                    ))}
                    {warehouses.filter((w) => !binQuery.trim() || w.toLowerCase().includes(binQuery.trim().toLowerCase())).length === 0 && (
                      <div className="p-3 text-xs text-muted-foreground">{t('inventoryOps.noBins')}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {(binOpen || binQuery) && (
              <button onClick={() => { setBinQuery(''); setBinOpen(false) }} className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label={t('inventoryOps.cancel')}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {binLoading && (
          <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('inventoryOps.loading')}
          </div>
        )}
        {binError && (
          <button onClick={() => selectedBin && loadBin(selectedBin)} className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            {t('inventoryOps.error')}
          </button>
        )}

        {!binLoading && !binError && binContents && selectedBin && (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  {selectedBin}
                </div>
                <div className="text-xs text-muted-foreground">
                  {binContents.items.length} {t('inventoryOps.itemsLabel')} · {binContents.total.toLocaleString()} {t('inventoryOps.onHand')}
                </div>
              </div>
              {binContents.items.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button onClick={downloadBinCsv} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                    <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
                  </button>
                  <button onClick={downloadBinPdf} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                    <FileText className="h-3.5 w-3.5" /> PDF
                  </button>
                </div>
              )}
            </div>
            {binContents.items.length === 0 ? (
              <div className="border-t border-border pt-3 text-xs text-muted-foreground">{t('inventoryOps.binEmpty')}</div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {binContents.items.map((it) => (
                  <li key={it.itemCode} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        {/* Part number first; name only when it differs (avoids the duplicate). */}
                        <div className="truncate font-mono text-sm font-medium">{it.itemCode}</div>
                        {it.itemName && it.itemName !== it.itemCode && (
                          <div className="truncate text-xs text-muted-foreground">{it.itemName}</div>
                        )}
                      </div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums">
                        {it.qty.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{it.uom}</span>
                      </div>
                    </div>
                    {it.pallets.length > 0 && (
                      <ul className="mt-1.5 divide-y divide-border rounded-lg border border-border bg-background">
                        {it.pallets.map((p) =>
                          renderPalletRow({ batch: p.batch, warehouse: selectedBin as string, qty: p.qty }, it.itemCode)
                        )}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </>
      )}

      {viewMode === 'transfer' && (
      <>
        {/* Pick the destination once, then scan/type pallet ids to build a queue and post
            them all at once (one atomic Material Transfer). */}
        <div className="mb-4">
          <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.transferDestination')}</label>
          <BinCombobox
            value={destBin}
            onChange={setDestBin}
            warehouses={warehouses}
            placeholder={t('inventoryOps.selectBin')}
            noBinsLabel={t('inventoryOps.noBins')}
          />
        </div>

        <div className="relative mb-2">
          <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addToQueue(scanInput)
              }
            }}
            disabled={!destBin}
            placeholder={destBin ? t('inventoryOps.transferScanPlaceholder') : t('inventoryOps.transferPickDest')}
            className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-24 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {queueBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={() => addToQueue(scanInput)}
              disabled={!destBin || !scanInput.trim() || queueBusy}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={t('inventoryOps.transferAdd')}
              title={t('inventoryOps.transferAdd')}
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => destBin && setTransferScanOpen(true)}
              disabled={!destBin}
              aria-label={t('inventoryOps.scan')}
              title={t('inventoryOps.scan')}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <ScanLine className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">
              {t('inventoryOps.transferQueue')} {transferQueue.length > 0 && <span className="text-muted-foreground">({transferQueue.length})</span>}
            </div>
            {transferQueue.length > 0 && (
              <button onClick={() => setTransferQueue([])} className="text-xs text-muted-foreground hover:text-foreground">
                {t('inventoryOps.transferClear')}
              </button>
            )}
          </div>
          {transferQueue.length === 0 ? (
            <div className="border-t border-border pt-3 text-xs text-muted-foreground">{t('inventoryOps.transferQueueEmpty')}</div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {transferQueue.map((p) => (
                <li key={p.batch} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-medium">{p.batch}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.itemCode} · {p.qty.toLocaleString()} · {p.warehouse} → {destBin}
                    </div>
                  </div>
                  <button
                    onClick={() => setTransferQueue((q) => q.filter((x) => x.batch !== p.batch))}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-red-600"
                    aria-label={t('inventoryOps.transferRemove')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={postTransfer}
            disabled={!destBin || transferQueue.length === 0 || posting}
            className="mt-3 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
            {t('inventoryOps.transferPost')}
          </button>
        </div>

        {lastTransfer && (
          <div className="mb-4 text-xs text-muted-foreground">
            {t('inventoryOps.transferLast')}: {(lastTransfer.count ?? 0).toLocaleString()} → <span className="font-mono">{lastTransfer.destination}</span>
            {lastTransfer.by ? ` · ${lastTransfer.by}` : ''}
            {lastTransfer.at ? ` · ${new Date(lastTransfer.at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}
          </div>
        )}

        {transferScanOpen && (
          <PalletScanner
            onClose={() => setTransferScanOpen(false)}
            onResult={(code) => {
              const now = Date.now()
              if (lastScanRef.current.code === code && now - lastScanRef.current.at < 2500) return
              lastScanRef.current = { code, at: now }
              addToQueue(code) // keep the scanner open for the next label
            }}
          />
        )}
      </>
      )}

      {viewMode === 'stage' && (
      <>
        {/* Scan pallets of one part, pick the open Sales Order that needs it, then reserve
            (lock) each pallet's batch to that order. Full coverage auto-marks it Staged. */}
        <div className="relative mb-2">
          <ScanLine className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={stageScanInput}
            onChange={(e) => setStageScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addToStageQueue(stageScanInput)
              }
            }}
            placeholder={t('inventoryOps.stageScanPlaceholder')}
            className="w-full rounded-lg border border-border bg-background py-3 pl-10 pr-24 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {stageQueueBusy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={() => addToStageQueue(stageScanInput)}
              disabled={!stageScanInput.trim() || stageQueueBusy}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              aria-label={t('inventoryOps.transferAdd')}
              title={t('inventoryOps.transferAdd')}
            >
              <Plus className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setStageScanOpen(true)}
              aria-label={t('inventoryOps.scan')}
              title={t('inventoryOps.scan')}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <ScanLine className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Scanned pallets queue */}
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">
              {t('inventoryOps.stageQueue')}{' '}
              {stageQueue.length > 0 && (
                <span className="text-muted-foreground">
                  ({stageQueue.length} · {stageQueuePcs.toLocaleString()} {t('inventoryOps.stagePieces')})
                </span>
              )}
            </div>
            {stageQueue.length > 0 && (
              <button onClick={() => setStageQueue([])} className="text-xs text-muted-foreground hover:text-foreground">
                {t('inventoryOps.transferClear')}
              </button>
            )}
          </div>
          {stageQueue.length === 0 ? (
            <div className="border-t border-border pt-3 text-xs text-muted-foreground">{t('inventoryOps.stageQueueEmpty')}</div>
          ) : (
            <>
              <div className="border-t border-border pt-2 text-xs text-muted-foreground">
                {stageQueue[0].itemCode} · {stageQueue[0].itemName}
              </div>
              <ul className="divide-y divide-border">
                {stageQueue.map((p) => (
                  <li key={p.batch} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-medium">{p.batch}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.qty.toLocaleString()} {t('inventoryOps.stagePieces')} · {p.warehouse}
                      </div>
                      {p.reservedTo && p.reservedTo.so !== selectedSo && (
                        <div className="mt-0.5 inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                          {t('inventoryOps.stageWillMove')} {p.reservedTo.so}
                          {p.reservedTo.customer ? ` (${p.reservedTo.customer})` : ''}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setStageQueue((q) => q.filter((x) => x.batch !== p.batch))}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-red-600"
                      aria-label={t('inventoryOps.transferRemove')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Open Sales Orders for the queued part — pick one to reserve against */}
        {stageQueue.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {t('inventoryOps.stagePickOrder')}
              {stageOrdersLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {/* One card per release LINE (soonest due first), identified by its
                dashboard line number — the floor's unique handle; the SO name only
                shows as a fallback for an unmapped line (Simon 2026-07-20). */}
            {!stageOrdersLoading && stageOrders.every((o) => o.lines.every((l) => !l.reservable)) ? (
              <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
                {t('inventoryOps.stageNoOrders')}
              </div>
            ) : (
              <ul className="space-y-2">
                {stageOrders
                  // Staging reserves stock — only reservable lines are targets
                  // (the add flow's informational attach still sees all lines).
                  .flatMap((o) => o.lines.filter((l) => l.reservable).map((l) => ({ o, l })))
                  .sort(
                    (a, b) =>
                      (a.l.deliveryDate ?? '9999-12-31').localeCompare(b.l.deliveryDate ?? '9999-12-31') ||
                      a.l.soItem.localeCompare(b.l.soItem)
                  )
                  .map(({ o, l }) => {
                    const projected = l.reservedQty + stageQueuePcs
                    const covers = l.orderedQty > 0 && projected >= l.orderedQty
                    // The queue must FIT: a line can't take more than it still
                    // needs (over-staging loophole, Simon 2026-07-03).
                    const remaining = l.orderedQty - l.reservedQty
                    const fits = stageQueuePcs <= remaining
                    const selected = selectedSoItem === l.soItem
                    return (
                      <li key={l.soItem}>
                        <button
                          onClick={() => {
                            if (!fits) return
                            setSelectedSo(o.name)
                            setSelectedSoItem(l.soItem)
                          }}
                          disabled={!fits}
                          className={`w-full rounded-xl border p-3 text-left transition-colors ${
                            !fits
                              ? 'border-border bg-card opacity-50 cursor-not-allowed'
                              : selected
                                ? 'border-primary bg-primary/5'
                                : 'border-border bg-card hover:bg-accent'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm font-medium">
                                <span className="font-mono">
                                  {l.dashboardLine != null
                                    ? `${t('inventoryOps.stageLine')} ${l.dashboardLine}`
                                    : o.name}
                                </span>
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {o.customer}
                                {o.poNo ? ` · ${t('inventoryOps.stagePo')} ${o.poNo}` : ''}
                                {l.deliveryDate ? ` · ${t('inventoryOps.stageDue')} ${l.deliveryDate}` : ''}
                              </div>
                            </div>
                            <div className="shrink-0 text-right text-xs">
                              <div className="font-medium">
                                {l.reservedQty.toLocaleString()} / {l.orderedQty.toLocaleString()}
                              </div>
                              <div className={!fits ? 'text-amber-600' : covers ? 'text-emerald-600' : 'text-muted-foreground'}>
                                {!fits
                                  ? t('inventoryOps.stageOnlyNeeds').replace('{n}', remaining.toLocaleString())
                                  : covers
                                    ? t('inventoryOps.stageWillCover')
                                    : `+${stageQueuePcs.toLocaleString()} → ${projected.toLocaleString()}`}
                              </div>
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
              </ul>
            )}
          </div>
        )}

        {/* Stage / Reserve */}
        <div className="mb-4">
          <button
            onClick={postStage}
            disabled={!selectedSo || !selectedSoItem || stageQueue.length === 0 || staging}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {staging ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            {t('inventoryOps.stageReserveBtn')}
          </button>
          {selectedSo && stageQueue.length > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              {stageQueue.length} {t('inventoryOps.stagePalletsWord')} · {stageQueuePcs.toLocaleString()} {t('inventoryOps.stagePieces')} → <span className="font-mono">{selectedSo}</span>
            </div>
          )}
        </div>

        {stageScanOpen && (
          <PalletScanner
            onClose={() => setStageScanOpen(false)}
            onResult={(code) => {
              const now = Date.now()
              if (lastStageScanRef.current.code === code && now - lastStageScanRef.current.at < 2500) return
              lastStageScanRef.current = { code, at: now }
              addToStageQueue(code) // keep the scanner open for the next label
            }}
          />
        )}
      </>
      )}

      {/* Recently printed labels — find a label whose print jammed and reprint it from its
          id, instead of guessing. Shows last 10; expand to 50. Visible in both views. */}
      <div className="mt-8 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Printer className="h-4 w-4 text-muted-foreground" />
            {t('inventoryOps.recentLabels')}
          </div>
          <button
            onClick={() => loadRecentLabels(recentExpanded)}
            disabled={recentLoading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title={t('inventoryOps.refresh')}
            aria-label={t('inventoryOps.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recentLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {recentLabels.length === 0 ? (
          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            {recentLoading ? t('inventoryOps.loading') : t('inventoryOps.noRecentLabels')}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border border-t border-border">
              {recentLabels.map((l, i) => {
                const s = labelStatus(l)
                const timeStr = l.at ? new Date(l.at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }) : ''
                // Serialized labels (pallet id + bin + qty) get the SAME actionable row as
                // the search results — history / move / reprint / edit / delete — by reusing
                // renderPalletRow. A context header carries the recent-label info (who/when).
                // A pallet label (has a batch + a known qty) gets the full action row.
                // Reprint ops record qty but not the bin, so we only require batch + qty
                // (not warehouse) — otherwise reprinted labels would lose their actions.
                if (l.batch && l.qty != null) {
                  return (
                    <li key={`${l.batch}-${l.at}-${i}`} className="py-2">
                      <div className="mb-1 flex items-start justify-between gap-3 px-2.5 text-xs text-muted-foreground">
                        <div className="min-w-0 truncate">
                          {l.itemCode}
                          {l.warehouse ? ` · ${l.warehouse}` : ''}
                          {l.purpose ? ` · ${purposeText(l.purpose)}` : ''}
                          {l.by ? ` · ${l.by}` : ''}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className={s.cls}>{s.text}</span>
                          {timeStr ? ` · ${timeStr}` : ''}
                          {l.printer ? ` · ${l.printer}` : ''}
                        </div>
                      </div>
                      <ul className="rounded-md border border-border bg-background/40">
                        {renderPalletRow(
                          { batch: l.batch, warehouse: l.warehouse ?? '', qty: l.qty, weightLb: l.weightLb ?? undefined, dims: l.dims ?? undefined },
                          l.itemCode
                        )}
                      </ul>
                    </li>
                  )
                }
                // Serialized but the op-log didn't carry bin/qty (e.g. an adjust/reprint
                // origin): keep the recovery actions — quick reprint + tap-the-id to open
                // it in the search (full actions there).
                if (l.batch) {
                  const wd = [l.weightLb ? `${l.weightLb.toLocaleString()} lb` : null, l.dims ? `${l.dims} in` : null].filter(Boolean).join(' · ')
                  const m = [l.itemCode, wd || null, l.purpose ? purposeText(l.purpose) : null, l.by || null].filter(Boolean).join(' · ')
                  return (
                    <li key={`${l.batch}-${l.at}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <button type="button" onClick={() => { setViewMode('item'); setQuery(l.batch as string); setItemPickerOpen(false) }} className="font-mono text-xs font-medium text-primary hover:underline">{l.batch}</button>
                        <div className="truncate text-xs text-muted-foreground">{m}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="text-right text-xs">
                          <div className={s.cls}>{s.text}</div>
                          <div className="text-muted-foreground">{timeStr}</div>
                          {l.printer && <div className="truncate text-muted-foreground">{l.printer}</div>}
                        </div>
                        <button type="button" onClick={() => submitReprint(l.itemCode, l.batch as string)} disabled={busyBatch === l.batch} title={t('inventoryOps.reprint')} aria-label={t('inventoryOps.reprint')} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
                          {busyBatch === l.batch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                        </button>
                      </div>
                    </li>
                  )
                }
                // Generic / non-serialized labels: no pallet id, so no pallet actions.
                // Show BOTH the count (pallets/boxes) and the total pieces (count x
                // pieces-per-pack), e.g. "10 pallets · 5,000 pieces".
                const meta = [
                  l.qty != null
                    ? `${l.qty.toLocaleString()} ${t('inventoryOps.pallets')} · ${(l.qty * (l.piecesPerPack || 1)).toLocaleString()} ${t('inventoryOps.parts')}`
                    : null,
                  l.purpose ? purposeText(l.purpose) : null,
                  l.by || null,
                ].filter(Boolean).join(' · ')
                return (
                  <li key={`${l.batch}-${l.at}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-medium">{l.itemCode}</div>
                      <div className="truncate text-xs text-muted-foreground">{meta}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={s.cls}>{s.text}</div>
                      <div className="text-muted-foreground">{timeStr}</div>
                      {l.printer && <div className="truncate text-muted-foreground">{l.printer}</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
            <button
              onClick={() => {
                const next = !recentExpanded
                setRecentExpanded(next)
                loadRecentLabels(next)
              }}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {recentExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {recentExpanded ? t('inventoryOps.showLess') : t('inventoryOps.showMore')}
            </button>
          </>
        )}
      </div>

      {/* Recently deleted labels — a pallet deleted by mistake can be returned to inventory in
          one click. Same quantity reuses the original label; a different quantity reprints a
          new label. Shows last 10; expand to 50. Same info as the printed log (pallet id,
          quantity, person) + History and Edit/restore. Visible on desktop + mobile. */}
      <div className="mt-8 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
            {t('inventoryOps.recentDeletions')}
          </div>
          <button
            onClick={() => loadDeletedLabels(deletedExpanded)}
            disabled={deletedLoading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title={t('inventoryOps.refresh')}
            aria-label={t('inventoryOps.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${deletedLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {deletedLabels.length === 0 ? (
          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            {deletedLoading ? t('inventoryOps.loading') : t('inventoryOps.noRecentDeletions')}
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border border-t border-border">
              {deletedLabels.map((l, i) => {
                const timeStr = l.at ? new Date(l.at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }) : ''
                const meta = [
                  l.itemCode,
                  l.qty != null ? `${l.qty.toLocaleString()} ${l.uom}` : null,
                  l.weightLb ? `${l.weightLb.toLocaleString()} lb` : null,
                  l.dims ? `${l.dims} in` : null,
                  l.warehouse,
                  l.by || null,
                ].filter(Boolean).join(' · ')
                const open = delRow === l.batch
                return (
                  <li key={`${l.batch}-${l.at}-${i}`} className="py-2">
                    <div className="flex items-start justify-between gap-3 px-0.5">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-medium">{l.batch}</div>
                        <div className="truncate text-xs text-muted-foreground">{meta}</div>
                        {timeStr && <div className="text-xs text-muted-foreground">{timeStr}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* History stays available even after a deletion is undone (it's a
                            read-only log); only the restore button is hidden once restored. */}
                        <button
                          type="button"
                          onClick={() => toggleHistory(l.batch)}
                          title={t('inventoryOps.history')}
                          aria-label={t('inventoryOps.history')}
                          className={`shrink-0 rounded-md p-1.5 hover:bg-accent hover:text-foreground ${historyOpen === l.batch ? 'text-primary' : 'text-muted-foreground'}`}
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                        {l.restored ? (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{t('inventoryOps.alreadyRestored')}</span>
                        ) : (
                          isOffice && (
                            <button
                              type="button"
                              onClick={() => openDeletedRestore(l)}
                              title={t('inventoryOps.restoreEdit')}
                              aria-label={t('inventoryOps.restoreEdit')}
                              className={`shrink-0 rounded-md p-1.5 hover:bg-accent hover:text-foreground ${open ? 'text-primary' : 'text-muted-foreground'}`}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    {historyOpen === l.batch && (
                      <div className="mt-2 rounded-md border border-border bg-muted/30 p-2">
                        {historyLoading === l.batch ? (
                          <div className="flex items-center gap-2 p-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('inventoryOps.loading')}
                          </div>
                        ) : (history[l.batch] ?? []).length === 0 ? (
                          <div className="p-1 text-xs text-muted-foreground">{t('inventoryOps.noHistory')}</div>
                        ) : (
                          <ul className="space-y-1.5">
                            {describeEvents(history[l.batch] ?? [], t).map((ev, hi) => (
                              <li key={hi} className="text-xs">
                                <span className="text-foreground">{ev.text}</span>
                                <span className="text-muted-foreground"> · {ev.by}{ev.at ? ` · ${ev.at}` : ''}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {open && isOffice && !l.restored && (
                      <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <div className="mb-2 text-sm font-medium">{t('inventoryOps.restoreTitle')}</div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                          <div className="sm:w-32">
                            <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.restoreQty')}</label>
                            <input
                              type="number"
                              min="1"
                              value={delQty}
                              onChange={(e) => setDelQty(e.target.value)}
                              className="w-full rounded border border-border bg-background px-2 py-2 text-sm"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.restoreBin')}</label>
                            <BinCombobox
                              value={delBin}
                              onChange={setDelBin}
                              warehouses={warehouses}
                              placeholder={t('inventoryOps.searchBin')}
                              noBinsLabel={t('inventoryOps.noBins')}
                            />
                          </div>
                          <button
                            onClick={() => submitDeletedRestore(l)}
                            disabled={delRestoring || !(Number(delQty) > 0) || !delBin}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                          >
                            {delRestoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            {t('inventoryOps.restoreConfirm')}
                          </button>
                        </div>
                        {Number(delQty) > 0 && l.qty != null && Number(delQty) !== l.qty && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>{t('inventoryOps.restoreNewLabelNote')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <button
              onClick={() => {
                const next = !deletedExpanded
                setDeletedExpanded(next)
                loadDeletedLabels(next)
              }}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {deletedExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {deletedExpanded ? t('inventoryOps.showLess') : t('inventoryOps.showMore')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
