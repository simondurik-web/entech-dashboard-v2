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
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
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
interface BinContentItem {
  itemCode: string
  itemName: string
  uom: string
  qty: number
  pallets: { batch: string; qty: number }[]
}
interface InventoryRow {
  itemCode: string
  itemName: string
  uom: string
  warehouse: string
  qty: number
  pallets: { batch: string; qty: number }[]
}
interface RecentLabel {
  batch: string
  itemCode: string
  printer: string | null
  printerLocation: string | null
  purpose: string | null
  by: string
  at: string | null
  status: string | null
  claimedAt: string | null
  printedAt: string | null
  error: string | null
}
interface Station {
  id: string
  name: string
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
  const [superseded, setSuperseded] = useState<{ scanned: string; current: string | null } | null>(null)

  const runSearch = useCallback(
    async (q: string, signal: AbortSignal) => {
      if (q.trim().length < 2) {
        setResults([])
        setSearched(false)
        setMatchedPallet(null)
        setSuperseded(null)
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

  // ─── By-item part-number picker (focus the search to browse/select all parts) ───
  const [itemPickerOpen, setItemPickerOpen] = useState(false)
  const [allItems, setAllItems] = useState<ItemOption[]>([])
  const [allItemsLoaded, setAllItemsLoaded] = useState(false)
  const [allItemsLoading, setAllItemsLoading] = useState(false)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openItemPicker = useCallback(() => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current) // cancel a pending close
    setItemPickerOpen(true)
    if (allItemsLoaded || allItemsLoading) return // load once; the loading flag dedupes rapid focus
    setAllItemsLoading(true)
    authedFetch('/api/erpnext/inventory/items?all=1')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setAllItems(d.items ?? [])
        setAllItemsLoaded(true)
      })
      .catch(() => {
        // Leave allItemsLoaded false so a later focus retries; the empty list just shows
        // "no results" (the user can still free-type to run the live search below).
      })
      .finally(() => setAllItemsLoading(false))
  }, [allItemsLoaded, allItemsLoading, authedFetch])

  // ─── pallets (per item) ───
  const [pallets, setPallets] = useState<Record<string, Pallet[]>>({})
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
  const showFlash = (kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg })
    if (flashRef.current) clearTimeout(flashRef.current)
    flashRef.current = setTimeout(() => setFlash(null), 5000)
  }
  const refreshSearch = useCallback(() => {
    const c = new AbortController()
    runSearch(query, c.signal)
  }, [query, runSearch])

  // ─── Locations view (browse by bin) ───
  const [viewMode, setViewMode] = useState<'item' | 'bin'>('item')
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

  // Toggle By item / By bin. RELOADS the view we switch INTO so it never shows data that
  // went stale from a mutation made in the other view, and closes any open edit/move/
  // history panel (those are single-value states shared by both views).
  const switchView = (mode: 'item' | 'bin') => {
    setViewMode(mode)
    setEditBatch(null)
    setMovingBatch(null)
    setHistoryOpen(null)
    if (mode === 'bin') {
      if (selectedBin) loadBin(selectedBin)
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
  const [addWarehouse, setAddWarehouse] = useState('') // committed bin selection
  const [whFilter, setWhFilter] = useState('') // combobox text (shows the selection or what's typed)
  const [whOpen, setWhOpen] = useState(false)
  const [addStation, setAddStation] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    // Pre-select the default bin AND show it in the combobox.
    if (defaultWarehouse) {
      setAddWarehouse(defaultWarehouse)
      setWhFilter((f) => f || defaultWarehouse)
    }
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
      const addedItemCode = addItem.itemCode
      showFlash('ok', `${t('inventoryOps.added')} ${d.batch}${d.labelPending ? ` (${t('inventoryOps.labelPending')})` : ''}`)
      setAddItem(null)
      setItemQuery('')
      setAddQty('')
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
        body: JSON.stringify({ batch, itemCode, newQty: qty, station: addStation || stations[0]?.id, idempotencyKey: opKey('adjust', batch, qty) }),
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
    const reason = window.prompt(t('inventoryOps.removeReason'))
    if (!reason?.trim()) return
    if (busyRef.current) return
    busyRef.current = true
    setBusyBatch(batch)
    try {
      const r = await authedFetch('/api/erpnext/inventory/remove', {
        method: 'POST',
        body: JSON.stringify({ batch, itemCode, reason: reason.trim(), idempotencyKey: opKey('remove', batch, reason.trim()) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'remove failed')
      clearOpKey('remove', batch, reason.trim())
      showFlash('ok', `${t('inventoryOps.removed')} ${batch}`)
      setHistoryOpen((h) => (h === batch ? null : h)) // removed pallet's row unmounts
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
        body: JSON.stringify({ batch, itemCode, station, idempotencyKey: opKey('reprint', batch, station) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'reprint failed')
      clearOpKey('reprint', batch, station)
      const serial = (d.batch as string) ?? batch
      // A reprint reissues the pallet as a new serial (old label is voided); follow it.
      showFlash('ok', `${t('inventoryOps.reprinted')} ${serial !== batch ? `${batch} -> ${serial}` : batch}`)
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

  if (!canAccess('/inventory-ops')) {
    return <div className="p-8 text-sm text-muted-foreground">{t('inventoryOps.noAccess')}</div>
  }

  const filteredMoveWarehouses = moveWhFilter
    ? warehouses.filter((w) => w.toLowerCase().includes(moveWhFilter.toLowerCase())).slice(0, 50)
    : warehouses.slice(0, 50)

  // Add-panel bin combobox options: show ALL bins when the box still shows the committed
  // selection (so a click reveals the full list), and filter only once the user types
  // something different.
  const addFilterActive = whFilter.trim() !== '' && whFilter !== addWarehouse
  let addBinOptions = (addFilterActive
    ? warehouses.filter((w) => w.toLowerCase().includes(whFilter.toLowerCase()))
    : warehouses
  ).slice(0, 50)
  // Always keep the committed bin visible in the full list (it could otherwise fall past
  // the 50-row cap when there are many bins).
  if (!addFilterActive && addWarehouse && warehouses.includes(addWarehouse) && !addBinOptions.includes(addWarehouse)) {
    addBinOptions = [addWarehouse, ...addBinOptions].slice(0, 50)
  }

  // Parts shown in the By-item picker: all parts, filtered by whatever's typed in the
  // search box (matches code or name). Rendered list is capped for DOM sanity; if more
  // match, a hint tells the user to keep typing (we never silently hide matches).
  const PART_PICKER_CAP = 500
  const partFilter = query.trim().toLowerCase()
  const matchedParts = partFilter
    ? allItems.filter((i) => i.itemCode.toLowerCase().includes(partFilter) || i.itemName.toLowerCase().includes(partFilter))
    : allItems
  const filteredParts = matchedParts.slice(0, PART_PICKER_CAP)
  const partsTruncated = matchedParts.length > filteredParts.length

  // Recent-labels helpers: map the op action to a friendly purpose, and the print-job
  // status to a label + color (so a jam/failure stands out).
  const PURPOSE_KEY: Record<string, string> = { add: 'added', adjust: 'adjusted', reprint: 'reprinted', remove: 'removed', move: 'moved' }
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
  const renderPalletRow = (p: { batch: string; warehouse: string; qty: number }, itemCode: string) => (
    <li key={p.batch} className="px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 font-mono text-xs">
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
              }}
              title={t('inventoryOps.editQty')}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {isOffice && (
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
            <div className="relative sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">{t('inventoryOps.bin')}</label>
              {/* Single combobox: shows the pre-selected default; click to see all bins or
                  type to filter. Unconfirmed text reverts to the committed bin on blur, so
                  submitAdd always has a valid selection (addWarehouse). */}
              <input
                value={whFilter}
                onChange={(e) => {
                  setWhFilter(e.target.value)
                  setWhOpen(true)
                }}
                onFocus={(e) => {
                  setWhOpen(true)
                  e.currentTarget.select() // highlight all so typing replaces (no manual delete)
                }}
                onBlur={() =>
                  setTimeout(() => {
                    setWhOpen(false)
                    setWhFilter(addWarehouse) // revert any unconfirmed typing to the selection
                  }, 150)
                }
                placeholder={t('inventoryOps.selectBin')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              {whOpen && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                  <div data-lenis-prevent className="inv-scroll max-h-60 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {addBinOptions.length === 0 ? (
                      <div className="p-2 text-xs text-muted-foreground">{t('inventoryOps.noBins')}</div>
                    ) : (
                      addBinOptions.map((w) => (
                        <button
                          type="button"
                          key={w}
                          // Prevent the input's blur (and its revert timer) from firing on the
                          // pick, so the committed bin and the displayed text never diverge.
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setAddWarehouse(w)
                            setWhFilter(w)
                            setWhOpen(false)
                          }}
                          className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent ${addWarehouse === w ? 'bg-primary/15 font-medium text-primary' : ''}`}
                        >
                          {w}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
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
              onClick={() => setItemPickerOpen(false)}
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
                      <span className="font-mono">{o.itemCode}</span>
                      <span className="text-muted-foreground"> — {o.itemName}</span>
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

      {superseded && (
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
                <div className="font-medium">{r.itemName}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.itemCode}</div>
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
              {palletsError[r.itemCode] ? (
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
            {binOpen && (
              <button onClick={() => setBinOpen(false)} className="rounded-md p-2 text-muted-foreground hover:text-foreground" aria-label={t('inventoryOps.cancel')}>
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
                        <div className="truncate text-sm font-medium">{it.itemName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{it.itemCode}</div>
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
                return (
                  <li key={`${l.batch}-${l.at}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-medium">{l.batch}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {l.itemCode}
                        {l.purpose ? ` · ${purposeText(l.purpose)}` : ''}
                        {l.by ? ` · ${l.by}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <div className={s.cls}>{s.text}</div>
                      <div className="text-muted-foreground">
                        {l.at ? new Date(l.at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
                      </div>
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
    </div>
  )
}
