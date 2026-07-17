'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  FileText,
  Keyboard,
  Package,
  Printer,
  RefreshCw,
  Truck,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'
import { usePermissions } from '@/lib/use-permissions'
import { authedJson } from '@/lib/authed-fetch'

// Ship Order — fulfillment wrapper, Phases 1+2.
// Phase 1: read-only order view (lines, staged pallets). Phase 2: scan/type each
// pallet to confirm the load — per-pallet green when it matches the order's
// staged records, red with a reason when it doesn't, remove for wrong scans,
// green "everything matches" light, and a final confirmation prompt. The actual
// ERPNext submission (Delivery Note + BOL) is Phase 3.
// NO dollar amounts anywhere on this screen, by design (Simon 2026-07-02).
// Designed iPhone-first: big tap targets, sticky scan bar, camera scanner.

const PalletScanner = dynamic(() => import('@/components/inventory/PalletScanner'), { ssr: false })
// react-pdf is browser-only — load the carrier-BOL signature placement UI lazily
const ExternalBolSignPlacement = dynamic(() => import('@/components/fulfillment/ExternalBolSignPlacement'), {
  ssr: false,
})

interface FulfillmentLine {
  soItem: string
  itemCode: string
  itemName: string
  hasImage: boolean
  orderedQty: number
  deliveredQty: number
  reservedQty: number
}

interface StagedPallet {
  palletId: string
  itemCode: string
  qty: number
  warehouse: string
  status: string
  // the SO Item row this reservation targets — attributes staged/scanned qty
  // to the RIGHT release line when the same item repeats (multi-release SOs)
  soDetail?: string | null
}

interface FulfillmentOrder {
  so: string
  customer: string
  poNo: string | null
  deliveryDate: string | null
  status: string
  stagingStatus: string | null
  stagedAt: string | null
  lines: FulfillmentLine[]
  pallets: StagedPallet[]
  deliveryNote: {
    name: string
    shipped: boolean
    attachments: string[]
    signed: boolean
    driverName: string | null
  } | null
  previousShipments: { name: string; signed: boolean; driverName: string | null }[]
}

interface LogEntry {
  id: number
  created_at: string
  action:
    | 'complete'
    | 'undo'
    | 'sign_bol'
    | 'sign_external_bol'
    | 'upload_customer_bol'
    | 'print_document'
    | 'move_reservation'
    | 'tl_release'
  dn_number: string
  user_name: string | null
  detail: string | null
}

// Truckload context for the chained ship flow (Simon 2026-07-08): several SOs
// locked to one physical truck. Single-order mode hard-blocks a member order
// (manager override releases it); ?tl= mode chains the member orders one after
// another, ends with ONE signature fanned out to every DN, and offers all the
// BOLs/packing slips together.
interface TruckloadOrderInfo {
  so_number: string
  order_key: string
  customer: string | null
  part_number: string | null
  position: number
  line: number | null
  so_item?: string | null
  status: 'pending' | 'shipped' | 'released'
  dn_number: string | null
}

interface TruckloadInfo {
  id: string
  load_number: string
  status: 'planned' | 'loading' | 'shipped' | 'canceled'
  notes: string | null
  truckload_orders: TruckloadOrderInfo[]
}

interface SessionScanState {
  ok: string[]
  mismatches: Mismatch[]
}

// Finger/mouse signature pad. Draws black strokes on a transparent canvas and
// returns a PNG data URL — the same shape ERPNext's own Signature field stores,
// so the BOL print format renders it without changes.
function SignaturePad({
  onChange,
  clearLabel,
}: {
  onChange: (dataUrl: string | null) => void
  clearLabel: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    const c = canvasRef.current
    if (!c) return
    c.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = c.getContext('2d')!
    const p = pos(e)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111'
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const c = canvasRef.current!
    const ctx = c.getContext('2d')!
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    hasInk.current = true
  }
  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (hasInk.current && canvasRef.current) onChange(canvasRef.current.toDataURL('image/png'))
  }
  const clear = () => {
    const c = canvasRef.current
    if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    hasInk.current = false
    onChange(null)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={200}
        className="w-full h-40 rounded-lg border border-border bg-white touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <button onClick={clear} className="mt-1 text-xs text-muted-foreground underline underline-offset-2">
        {clearLabel}
      </button>
    </div>
  )
}

interface PalletLookup {
  palletId: string
  itemCode: string | null
  disabled: boolean
  reservedTo: { so: string } | null
}

// A wrong scan, with the reason it doesn't belong to this load.
interface Mismatch {
  palletId: string
  reason: string
}

export default function ShipOrderPage() {
  return (
    <Suspense>
      <ShipOrderContent />
    </Suspense>
  )
}

function ShipOrderContent() {
  const { t } = useI18n()
  const { canAccessExact } = usePermissions()
  const canShip = canAccessExact('ship_loads')
  const canManageTruckloads = canAccessExact('manage_truckloads')
  const searchParams = useSearchParams()
  const soParam = (searchParams.get('so') ?? '').trim()
  const tlId = (searchParams.get('tl') ?? '').trim() || null

  // ─── Truckload mode state ───
  const [truckload, setTruckload] = useState<TruckloadInfo | null>(null)
  const [tlLoading, setTlLoading] = useState(!!tlId)
  // the SO the scan UI operates on — the ?so= order in single mode, the
  // current pending member in truckload mode
  const [activeSo, setActiveSo] = useState<string>(tlId ? '' : soParam)
  const so = activeSo
  const [tlCompleted, setTlCompleted] = useState<{ so: string; dn: string; orderKey?: string }[]>([])
  // the CURRENT member entry — one dashboard line, not the whole SO
  const [tlMember, setTlMember] = useState<TruckloadOrderInfo | null>(null)
  // crew's explicit pick of which member to scan next (Simon 2026-07-09:
  // don't force the queue order — the yard dictates what gets loaded first)
  const [tlPickedKey, setTlPickedKey] = useState<string | null>(null)
  const [tlSignDone, setTlSignDone] = useState(false)
  const [tlSigning, setTlSigning] = useState(false)
  // signed state per DN — lets a revisit (new session, tlCompleted empty) still
  // offer the sign pad for unsigned BOLs. TL-0002 incident 2026-07-09: the crew
  // left the completion screen before signing and there was no way back to it.
  const [dnSignedMap, setDnSignedMap] = useState<Record<string, boolean>>({})
  const [printingAll, setPrintingAll] = useState<{ done: number; total: number } | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [mgrEmail, setMgrEmail] = useState('')
  const [mgrPass, setMgrPass] = useState('')
  const [overriding, setOverriding] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [releasedNote, setReleasedNote] = useState<string | null>(null)
  // BOL/packing-slip copies — shipping always wants 2 (Simon 2026-07-08)
  const [copies, setCopies] = useState(2)
  // ─── Server-side scan session (refresh-proof) ───
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [sessionRestored, setSessionRestored] = useState(false)
  const scannedBySoRef = useRef<Record<string, SessionScanState>>({})
  const hydratedForSo = useRef<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // scan-state bucket: per member line in truckload mode, per SO otherwise
  const scanBucket = tlId ? (tlMember?.order_key ?? '') : soParam

  const [order, setOrder] = useState<FulfillmentOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const imagesRef = useRef<Record<string, string>>({})

  // ─── Scan state (Phase 2) ───
  const [scannedOk, setScannedOk] = useState<Set<string>>(new Set())
  const [mismatches, setMismatches] = useState<Mismatch[]>([])
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanKey, setScanKey] = useState(0) // remount the scanner after each decode -> continuous scanning
  const [typedOpen, setTypedOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [shipError, setShipError] = useState<string | null>(null)
  // Set right after a successful completion (before the re-fetch lands) so the
  // shipped view shows instantly; on later visits order.deliveryNote drives it.
  const [justShipped, setJustShipped] = useState<{ dn: string; docsOk: boolean } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadedBols, setUploadedBols] = useState<string[]>([])
  // Carrier (external) BOL per DN — drives the extra view/print buttons and the
  // tap-to-place signature step (outside-trucking paperwork). extBolReady gates
  // the truckload "print everything" button so an early tap can't silently skip
  // carrier BOLs that were still being discovered.
  const [extBol, setExtBol] = useState<Record<string, { exists: boolean; signed: boolean }>>({})
  const [extBolReady, setExtBolReady] = useState(false)
  // Letter-printer stations (print relay) for physical BOL/packing-slip printing
  const [printStations, setPrintStations] = useState<{ id: string; name: string }[]>([])
  const [printStation, setPrintStation] = useState('')
  const [printing, setPrinting] = useState<string | null>(null)
  const [printQueuedMsg, setPrintQueuedMsg] = useState<string | null>(null)
  // BOL signature step
  const [signature, setSignature] = useState<string | null>(null)
  const [driverName, setDriverName] = useState('')
  const [signing, setSigning] = useState(false)
  const [signSkipped, setSignSkipped] = useState(false)
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const authedFetch = useCallback(async (url: string) => {
    const run = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      return fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    }
    let res = await run()
    if (res.status === 401) {
      await supabase.auth.refreshSession()
      res = await run()
    }
    return res
  }, [])

  // Does each shipped DN have a carrier-provided (external) BOL on file, and has
  // the driver's signature already been stamped onto it?
  const fetchExtBol = useCallback(
    async (dns: string[]) => {
      const entries = await Promise.all(
        dns.map(async (dn) => {
          try {
            const res = await authedFetch(`/api/erpnext/fulfillment/external-bol?dn=${encodeURIComponent(dn)}`)
            if (!res.ok) return null
            const b = await res.json()
            return [dn, { exists: !!b.exists, signed: !!b.signed }] as const
          } catch {
            return null
          }
        })
      )
      const map: Record<string, { exists: boolean; signed: boolean }> = {}
      for (const e of entries) if (e) map[e[0]] = e[1]
      if (Object.keys(map).length) setExtBol((prev) => ({ ...prev, ...map }))
    },
    [authedFetch]
  )

  const fetchOrder = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch(`/api/erpnext/fulfillment/order?so=${encodeURIComponent(so)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error === 'Order not found' ? 'notfound' : 'failed')
      }
      const body = await res.json()
      setOrder(body.order as FulfillmentOrder)
    } catch (err) {
      setError(err instanceof Error && err.message === 'notfound' ? t('fulfillment.notFound') : t('fulfillment.loadError'))
    } finally {
      setLoading(false)
    }
  }, [so, authedFetch, t])

  useEffect(() => {
    if (so) fetchOrder()
    else if (!tlId) {
      setLoading(false)
      setError(t('fulfillment.notFound'))
    } else {
      // truckload mode with no current order (all members done) — drop the
      // last fetched order so the completion panel stands alone
      setLoading(false)
      setOrder(null)
    }
  }, [so, tlId, fetchOrder, t])

  // ─── Truckload mode: load the truckload, walk its pending orders ───
  const truckloadRef = useRef<TruckloadInfo | null>(null)
  useEffect(() => {
    truckloadRef.current = truckload
  }, [truckload])
  const fetchTruckload = useCallback(async () => {
    if (!tlId) return
    try {
      const res = await authedFetch(`/api/truckloads/${encodeURIComponent(tlId)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'failed')
      setTruckload(body.truckload as TruckloadInfo)
    } catch {
      // a transient refresh failure must not blank an in-progress flow — the
      // completion panel after the LAST order was one fetch away from being
      // hidden behind a fatal error (TL-0002 incident 2026-07-09)
      if (!truckloadRef.current) setError(t('fulfillment.loadError'))
    } finally {
      setTlLoading(false)
    }
  }, [tlId, authedFetch, t])

  useEffect(() => {
    if (tlId) fetchTruckload()
  }, [tlId, fetchTruckload])

  // current member = first pending LINE not yet completed this session (an SO
  // can appear twice with different lines — track by order_key, not SO)
  useEffect(() => {
    if (!tlId || !truckload) return
    const doneKeys = new Set(tlCompleted.map((c) => c.orderKey ?? c.so))
    const pending = truckload.truckload_orders.filter(
      (o) => o.status === 'pending' && !doneKeys.has(o.order_key) && !doneKeys.has(o.so_number)
    )
    const picked = tlPickedKey ? pending.find((o) => o.order_key === tlPickedKey) : undefined
    const next = picked ?? pending[0]
    setTlMember(next ?? null)
    setActiveSo((prev) => {
      const target = next ? next.so_number : ''
      return prev === target ? prev : target
    })
  }, [tlId, truckload, tlCompleted, tlPickedKey])

  // ─── Single-order mode: hard block when the SO belongs to a truckload ───
  useEffect(() => {
    if (tlId || !soParam) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await authedFetch('/api/truckloads?scope=active')
        if (!res.ok) return
        const body = await res.json()
        const tls = (body.truckloads ?? []) as TruckloadInfo[]
        const member = tls.find((tl) =>
          tl.truckload_orders.some((o) => o.so_number === soParam && o.status === 'pending')
        )
        if (!cancelled) setTruckload(member ?? null)
      } catch {
        /* block is enforced server-side too (complete refuses spoofed TLs) */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tlId, soParam, authedFetch, releasedNote])

  // ─── Ship session: restore progress from the server (refresh-proof) ───
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!tlId && !soParam) {
        setSessionReady(true)
        return
      }
      try {
        const qs = tlId ? `tl=${encodeURIComponent(tlId)}` : `so=${encodeURIComponent(soParam)}`
        const res = await authedFetch(`/api/ship-sessions?${qs}`)
        const body = res.ok ? await res.json() : null
        if (cancelled) return
        const s = body?.session
        if (s) {
          setSessionId(s.id as string)
          scannedBySoRef.current = (s.scanned ?? {}) as Record<string, SessionScanState>
          if (Array.isArray(s.completed)) setTlCompleted(s.completed as { so: string; dn: string }[])
          if (s.driver_name) setDriverName(s.driver_name as string)
        }
      } catch {
        /* no session -> fresh start */
      } finally {
        if (!cancelled) setSessionReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlId, soParam])

  // apply the restored scans to the CURRENT order once it loads (stale scans
  // for pallets no longer staged are dropped; red mismatches are kept)
  useEffect(() => {
    if (!order || !sessionReady || !scanBucket) return
    if (hydratedForSo.current === scanBucket) return
    hydratedForSo.current = scanBucket
    const data = scannedBySoRef.current[scanBucket]
    if (data && (data.ok.length || data.mismatches.length)) {
      const staged = new Set(order.pallets.map((p) => p.palletId.toUpperCase()))
      const ok = (data.ok ?? []).filter((c) => staged.has(c))
      setScannedOk(new Set(ok))
      setMismatches(data.mismatches ?? [])
      if (ok.length) setSessionRestored(true)
    }
  }, [order, sessionReady, scanBucket])

  const saveSession = useCallback(
    async (completedOverride?: { so: string; dn: string }[]) => {
      const primarySo = tlId ? (truckload?.truckload_orders[0]?.so_number ?? so) : soParam
      if (!primarySo) return
      try {
        const res = await authedJson('/api/ship-sessions', 'POST', {
          so: primarySo,
          truckloadId: tlId ?? undefined,
          scanned: scannedBySoRef.current,
          completed: completedOverride ?? tlCompleted,
          driverName: driverName || undefined,
        })
        const body = await res.json().catch(() => null)
        if (res.ok && body?.id) setSessionId(body.id as string)
      } catch {
        /* next scan retries; worst case = old behavior (in-memory only) */
      }
    },
    [tlId, truckload, so, soParam, tlCompleted, driverName]
  )

  const closeSession = useCallback(async () => {
    if (!sessionId) return
    try {
      await authedJson('/api/ship-sessions', 'PATCH', { id: sessionId, status: 'completed' })
    } catch {
      /* stale sessions are adopted+overwritten by the next shipment */
    }
  }, [sessionId])

  // save after every scan / driver-name change (debounced). Waits until the
  // restore pass has run for this SO — running earlier would overwrite the
  // just-restored server state with the initial empty scan set (found in the
  // 2026-07-08 refresh test).
  useEffect(() => {
    if (!sessionReady) return
    if (scanBucket) {
      if (hydratedForSo.current !== scanBucket) return
      scannedBySoRef.current[scanBucket] = { ok: [...scannedOk], mismatches }
    } else if (!tlId || tlCompleted.length === 0) {
      // no active bucket and nothing completed -> nothing worth saving. With
      // completions, keep saving: the driver name typed on the sign screen
      // (scanBucket is '' once every member is done) must survive a refresh.
      return
    }
    const hasAny =
      tlCompleted.length > 0 ||
      Object.values(scannedBySoRef.current).some((v) => v.ok.length > 0 || v.mismatches.length > 0)
    if (!hasAny) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveSession()
    }, 600)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedOk, mismatches, driverName, sessionReady, scanBucket])

  // The page stays mounted across a ?so= change — without this reset, a just-
  // shipped order's DN banner and scan set bled into the NEXT order opened
  // from the same tab (bug-hunt 2026-07-04).
  useEffect(() => {
    setScannedOk(new Set())
    setMismatches([])
    setJustShipped(null)
    setUploadedBols([])
    setSignSkipped(false)
  }, [so, scanBucket])

  // Item pictures: the ERP files host is behind Cloudflare Access, so images are
  // proxied through an authed API route and rendered from blob URLs.
  useEffect(() => {
    if (!order) return
    let cancelled = false
    const codes = [...new Set(order.lines.filter((l) => l.hasImage).map((l) => l.itemCode))]
    codes.forEach(async (code) => {
      if (imagesRef.current[code]) return
      try {
        const res = await authedFetch(`/api/erpnext/fulfillment/item-image?item=${encodeURIComponent(code)}`)
        if (!res.ok) return
        const url = URL.createObjectURL(await res.blob())
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        imagesRef.current = { ...imagesRef.current, [code]: url }
        setImages(imagesRef.current)
      } catch {
        // no picture is fine — the card falls back to an icon
      }
    })
    return () => {
      cancelled = true
    }
  }, [order, authedFetch])

  useEffect(() => {
    return () => {
      Object.values(imagesRef.current).forEach((u) => URL.revokeObjectURL(u))
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    }
  }, [])

  // Uppercased: scans are canonicalized to uppercase, and the server compares
  // case-insensitively — a lowercase pallet id could otherwise never match its
  // own scan (bug-hunt 2026-07-04).
  // Line scope (Simon 2026-07-09): in truckload mode only the CURRENT member
  // line's pallets count — sibling lines keep their pallets for later loads.
  const scopedPallets = useMemo(() => {
    const all = order?.pallets ?? []
    if (!tlId || !tlMember?.so_item) return all
    return all.filter((p) => p.soDetail === tlMember.so_item)
  }, [order, tlId, tlMember])

  const stagedIds = useMemo(() => new Set(scopedPallets.map((p) => p.palletId.toUpperCase())), [scopedPallets])
  const lineItemCodes = useMemo(() => new Set((order?.lines ?? []).map((l) => l.itemCode)), [order])

  // Attribute a pallet to a line by the reservation's SO Item row when known —
  // a multi-release SO repeats the same item on several lines, and itemCode
  // matching alone painted EVERY line with the one staged release's qty.
  const palletBelongsToLine = (p: StagedPallet, line: { soItem: string; itemCode: string }) =>
    p.soDetail ? p.soDetail === line.soItem : p.itemCode === line.itemCode
  const stagedQtyFor = (line: { soItem: string; itemCode: string }) =>
    (order?.pallets ?? []).filter((p) => palletBelongsToLine(p, line)).reduce((s, p) => s + p.qty, 0)
  const scannedQtyFor = (line: { soItem: string; itemCode: string }) =>
    (order?.pallets ?? [])
      .filter((p) => palletBelongsToLine(p, line) && scannedOk.has(p.palletId.toUpperCase()))
      .reduce((s, p) => s + p.qty, 0)

  const totalStaged = scopedPallets.length
  const totalScanned = scannedOk.size
  const allMatch = totalStaged > 0 && totalScanned === totalStaged && mismatches.length === 0

  const showFeedback = useCallback((ok: boolean, text: string) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    setFeedback({ ok, text })
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
  }, [])

  /** One scanned/typed code -> green (matches a staged pallet) or red with a reason. */
  const processScan = useCallback(
    async (raw: string) => {
      const code = raw.trim().toUpperCase()
      if (!code || !order) return

      if (scannedOk.has(code) || mismatches.some((m) => m.palletId === code)) {
        showFeedback(false, `${code} — ${t('fulfillment.alreadyScanned')}`)
        return
      }
      if (stagedIds.has(code)) {
        setScannedOk((prev) => new Set(prev).add(code))
        showFeedback(true, `${code} — ${t('fulfillment.palletOk')}`)
        return
      }

      // Not part of this load — find out why (red row either way).
      let reason = t('fulfillment.notOnOrder')
      try {
        const res = await authedFetch(`/api/erpnext/fulfillment/pallet?id=${encodeURIComponent(code)}`)
        if (res.ok) {
          const { pallet } = (await res.json()) as { pallet: PalletLookup }
          if (!pallet.itemCode) reason = t('fulfillment.unknownPallet')
          else if (pallet.disabled) reason = t('fulfillment.oldLabel')
          else if (pallet.reservedTo && pallet.reservedTo.so !== order.so)
            reason = t('fulfillment.otherOrder').replace('{so}', pallet.reservedTo.so)
          else if (!lineItemCodes.has(pallet.itemCode))
            reason = t('fulfillment.wrongProduct').replace('{item}', pallet.itemCode)
          else reason = t('fulfillment.notStaged')
        }
      } catch {
        // keep the generic reason — the row is red regardless
      }
      setMismatches((prev) =>
        prev.some((m) => m.palletId === code) ? prev : [...prev, { palletId: code, reason }]
      )
      showFeedback(false, `${code} — ${reason}`)
    },
    [order, scannedOk, mismatches, stagedIds, lineItemCodes, authedFetch, showFeedback, t]
  )

  const removeScan = (code: string) => {
    setScannedOk((prev) => {
      if (!prev.has(code)) return prev
      const next = new Set(prev)
      next.delete(code)
      return next
    })
    setMismatches((prev) => prev.filter((m) => m.palletId !== code))
  }

  const submitTyped = () => {
    const value = typed
    setTyped('')
    processScan(value)
  }

  const authedPost = useCallback(
    async (url: string, body: unknown) => {
      const run = async () => {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        return fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        })
      }
      let res = await run()
      if (res.status === 401) {
        await supabase.auth.refreshSession()
        res = await run()
      }
      return res
    },
    []
  )

  const doComplete = async () => {
    if (!order || submitting) return
    setSubmitting(true)
    setShipError(null)
    try {
      const res = await authedPost('/api/erpnext/fulfillment/complete', {
        so: order.so,
        pallets: [...scannedOk],
        truckloadId: tlId ?? undefined,
        orderKey: tlId ? tlMember?.order_key : undefined,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t('fulfillment.shipFailed'))
      setConfirmOpen(false)
      const dn = body.result.dn as string
      if (tlId) {
        // chained flow: log the DN, clear this order's scans, advance to the
        // next member — the ONE signature comes after the last order
        delete scannedBySoRef.current[scanBucket]
        const nextCompleted = [...tlCompleted, { so: order.so, dn, orderKey: tlMember?.order_key }]
        setTlCompleted(nextCompleted)
        setTlPickedKey(null)
        setScannedOk(new Set())
        setMismatches([])
        showFeedback(true, t('fulfillment.tlOrderDone').replace('{so}', order.so))
        void saveSession(nextCompleted)
        void fetchTruckload()
      } else {
        setJustShipped({
          dn,
          docsOk: !!(body.result.attachedBol && body.result.attachedPackingSlip && !body.result.warning),
        })
        delete scannedBySoRef.current[order.so]
        void closeSession()
        fetchOrder() // refresh statuses/delivered qtys in the background
      }
    } catch (err) {
      setConfirmOpen(false)
      setShipError(err instanceof Error ? err.message : t('fulfillment.shipFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // one signature + driver name -> every still-unsigned DN of the truckload
  // (decision: the driver signs once, all BOLs carry it). Iterates the
  // unsigned set, not this session's completions, so a revisit can sign too.
  const doTlSignAll = async () => {
    if (!signature || tlSigning || tlUnsignedDns.length === 0) return
    setTlSigning(true)
    setShipError(null)
    try {
      for (const dn of tlUnsignedDns) {
        const res = await authedPost('/api/erpnext/fulfillment/sign-bol', {
          dn,
          driverName,
          signature,
        })
        if (!res.ok) {
          const b = await res.json().catch(() => null)
          throw new Error(b?.error || t('fulfillment.signFailed'))
        }
      }
      setDnSignedMap((prev) => {
        const next = { ...prev }
        for (const dn of tlUnsignedDns) next[dn] = true
        return next
      })
      setTlSignDone(true)
      void closeSession()
      fetchLog()
    } catch (err) {
      setShipError(err instanceof Error ? err.message : t('fulfillment.signFailed'))
    } finally {
      setTlSigning(false)
    }
  }

  // manager override: release this order from its truckload so it ships alone
  const doOverride = async () => {
    if (!truckload || overriding) return
    setOverriding(true)
    setOverrideError(null)
    try {
      const member = truckload.truckload_orders.find((o) => o.so_number === soParam && o.status === 'pending')
      if (!member) throw new Error(t('fulfillment.notFound'))
      const res = await authedJson('/api/truckloads/release', 'POST', {
        truckloadId: truckload.id,
        orderKey: member.order_key,
        managerEmail: canManageTruckloads ? undefined : mgrEmail,
        managerPassword: canManageTruckloads ? undefined : mgrPass,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          body?.error === 'manager_required' ? t('fulfillment.tlOverrideHint') : body?.error || t('fulfillment.shipFailed')
        )
      }
      setReleasedNote((body.releasedBy as string) || 'manager')
      setTruckload(null)
      setOverrideOpen(false)
      setMgrEmail('')
      setMgrPass('')
      fetchLog()
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : t('fulfillment.shipFailed'))
    } finally {
      setOverriding(false)
    }
  }

  const doUndo = async (dn: string) => {
    if (undoing) return
    if (!window.confirm(t('fulfillment.undoConfirm'))) return
    setUndoing(true)
    setShipError(null)
    try {
      const res = await authedPost('/api/erpnext/fulfillment/undo', { dn })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t('fulfillment.undoFailed'))
      setJustShipped(null)
      setScannedOk(new Set())
      setMismatches([])
      await fetchOrder()
    } catch (err) {
      setShipError(err instanceof Error ? err.message : t('fulfillment.undoFailed'))
    } finally {
      setUndoing(false)
    }
  }

  const fetchLog = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/erpnext/fulfillment/log?so=${encodeURIComponent(so)}`)
      if (res.ok) {
        const body = await res.json()
        setLogEntries((body.entries ?? []) as LogEntry[])
      }
    } catch {
      // log display is best-effort
    }
  }, [so, authedFetch])

  useEffect(() => {
    if (so) fetchLog()
  }, [so, fetchLog, justShipped, undoing])

  const doSignBol = async (dn: string) => {
    if (!signature || signing) return
    setSigning(true)
    setShipError(null)
    try {
      const res = await authedPost('/api/erpnext/fulfillment/sign-bol', {
        dn,
        driverName,
        signature,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t('fulfillment.signFailed'))
      setSignature(null)
      await fetchOrder()
      fetchLog()
    } catch (err) {
      setShipError(err instanceof Error ? err.message : t('fulfillment.signFailed'))
    } finally {
      setSigning(false)
    }
  }

  // Load letter-printer stations once a shipment exists (Ship Loads users only)
  useEffect(() => {
    if (!canShip) return
    let mounted = true
    ;(async () => {
      try {
        const res = await authedFetch('/api/erpnext/fulfillment/print-document')
        if (!res.ok) return
        const body = await res.json()
        if (!mounted) return
        const stations = (body.stations ?? []) as { id: string; name: string }[]
        setPrintStations(stations)
        setPrintStation((s) => s || stations[0]?.id || '')
      } catch {
        /* no relay printing available */
      }
    })()
    return () => {
      mounted = false
    }
  }, [canShip, authedFetch])

  const doPrintDocument = async (dn: string, type: 'bol' | 'packing' | 'customer_bol') => {
    if (!printStation || printing) return
    setPrinting(type)
    setShipError(null)
    setPrintQueuedMsg(null)
    try {
      const res = await authedPost('/api/erpnext/fulfillment/print-document', {
        dn,
        type,
        station: printStation,
        copies,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t('fulfillment.printFailed'))
      setPrintQueuedMsg(t('fulfillment.printQueued'))
      fetchLog()
      setTimeout(() => setPrintQueuedMsg(null), 5000)
    } catch (err) {
      setShipError(err instanceof Error ? err.message : t('fulfillment.printFailed'))
    } finally {
      setPrinting(null)
    }
  }

  const doUploadBol = async (dn: string, file: File) => {
    setUploading(true)
    setShipError(null)
    try {
      const form = new FormData()
      form.set('dn', dn)
      form.set('file', file)
      const post = async () => {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        return fetch('/api/erpnext/fulfillment/upload-bol', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        })
      }
      let res = await post()
      // Same 401 -> refresh -> retry the rest of the page's calls get; an
      // expired token mid-upload failed outright before (bug-hunt 2026-07-04).
      if (res.status === 401) {
        await supabase.auth.refreshSession()
        res = await post()
      }
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || t('fulfillment.uploadFailed'))
      setUploadedBols((prev) => [...prev, body.fileName as string])
      void fetchExtBol([dn]) // the carrier BOL buttons appear right away
    } catch (err) {
      setShipError(err instanceof Error ? err.message : t('fulfillment.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  // Open a PDF (BOL / packing slip), fetched with auth. In the installed PWA
  // (standalone Safari) window.open is a no-op, so on devices that support file
  // sharing we hand the PDF to the iOS share sheet instead — which includes
  // Print (AirPrint) and Save to Files. Desktop keeps the new-tab viewer.
  const openDocument = async (dn: string, type: 'bol' | 'packing' | 'customer_bol') => {
    try {
      const res = await authedFetch(
        `/api/erpnext/fulfillment/document?dn=${encodeURIComponent(dn)}&type=${type}&copies=${copies}`
      )
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const fileName = `${type === 'bol' ? 'BOL' : type === 'customer_bol' ? 'CustomerBOL' : 'PackingSlip'}-${dn}.pdf`
      const file = new File([blob], fileName, { type: 'application/pdf' })
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      if (standalone && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] })
          return
        } catch (e) {
          if ((e as Error).name === 'AbortError') return // user closed the sheet
          // fall through to the blob URL path
        }
      }
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank')
      if (!win) {
        // popup blocked / standalone without share support: navigate in place
        // (Safari renders the PDF; back returns to the app)
        window.location.assign(url)
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setShipError(t('fulfillment.documentFailed'))
    }
  }

  // Release-scoped shipped state (Simon 2026-07-08): a multi-release SO ships
  // one DN per release, so a PAST shipped DN only drives the completed view
  // while nothing is staged for the next release. The moment new pallets are
  // staged, the scan flow returns and earlier DNs move to the "previous
  // shipments" strip. The full-order banner is reserved for the SO actually
  // being fully shipped (staging status rollup fires only when every line
  // delivered in full).
  // ─── Truckload derived state ───
  // single mode: a pending member order is hard-blocked (decision 3) until a
  // manager releases it or the whole truckload is shipped via ?tl=
  const tlBlocked =
    !tlId && !!truckload && truckload.truckload_orders.some((o) => o.so_number === soParam && o.status === 'pending')
  const tlActiveOrders = (truckload?.truckload_orders ?? []).filter((o) => o.status !== 'released')
  // chained mode: no current SO left -> every member is shipped. The docs list
  // comes from this session's completions, or (revisiting a finished
  // truckload after the session closed) from the shipped member rows.
  const tlDocsList =
    tlCompleted.length > 0
      ? tlCompleted
      : (truckload?.truckload_orders ?? [])
          .filter((o) => o.status === 'shipped' && o.dn_number)
          .map((o) => ({ so: o.so_number, dn: o.dn_number as string }))
  const tlAllDone = !!tlId && !!truckload && !tlLoading && so === '' && tlDocsList.length > 0
  // DNs still needing the driver signature. Fresh completions are unsigned by
  // definition; on a revisit the fetched signed map decides — so the sign pad
  // comes back for an unsigned load instead of being locked to the original
  // session (the TL-0002 miss).
  const tlUnsignedDns = tlDocsList
    .filter((c) => (dnSignedMap[c.dn] !== undefined ? !dnSignedMap[c.dn] : tlCompleted.length > 0))
    .map((c) => c.dn)
  const tlPosition = Math.min(tlCompleted.length + 1, Math.max(tlActiveOrders.length, 1))
  // ONE carrier BOL per truckload — the representative DN (signed copy first)
  const tlExtDn =
    tlDocsList.find((c) => extBol[c.dn]?.signed)?.dn ??
    tlDocsList.find((c) => extBol[c.dn]?.exists)?.dn ??
    null

  // fetch the signed state of every DN on the completion screen — powers the
  // per-DN "Signed" badge and re-offers the sign pad for unsigned BOLs
  const tlDnsKey = tlDocsList.map((c) => c.dn).join(',')
  useEffect(() => {
    if (!tlAllDone || !tlDnsKey) return
    let cancelled = false
    ;(async () => {
      const map: Record<string, boolean> = {}
      const sos = [...new Set(tlDocsList.map((c) => c.so))]
      await Promise.all(
        sos.map(async (soName) => {
          try {
            const res = await authedFetch(`/api/erpnext/fulfillment/order?so=${encodeURIComponent(soName)}`)
            if (!res.ok) return
            const body = await res.json()
            const o = body.order as FulfillmentOrder
            for (const d of [o.deliveryNote, ...(o.previousShipments ?? [])]) {
              if (d) map[d.name] = !!d.signed
            }
          } catch {
            /* unknown DNs fall back to the session heuristic */
          }
        })
      )
      if (!cancelled && Object.keys(map).length) setDnSignedMap((prev) => ({ ...prev, ...map }))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tlAllDone, tlDnsKey, tlSignDone, authedFetch])

  // carrier-BOL presence for every DN on the truckload completion screen
  useEffect(() => {
    if (!tlAllDone || !tlDnsKey) return
    setExtBolReady(false)
    void fetchExtBol(tlDnsKey.split(',')).finally(() => setExtBolReady(true))
  }, [tlAllDone, tlDnsKey, fetchExtBol])

  // ONE tap -> packing slip + BOL for EVERY order of the load, ×copies each
  // (Simon 2026-07-09: no per-order printing at the end of a truckload)
  const doPrintAllDocuments = async () => {
    if (!printStation || printingAll || tlDocsList.length === 0) return
    // packing slip + our BOL per DN, plus the carrier's own BOL ONCE for the
    // whole truck (one external BOL per truckload — Simon 2026-07-17), taken
    // from the DN whose signed copy exists, else any DN that resolves one.
    // If every presence lookup failed, one optional attempt still goes out —
    // the server's 404 for a no-BOL truck is tolerated, so a flaky lookup can
    // only add a harmless try, never silently drop the document.
    const jobs: { dn: string; type: 'packing' | 'bol' | 'customer_bol'; optional?: boolean }[] =
      tlDocsList.flatMap((c) => (['packing', 'bol'] as const).map((type) => ({ dn: c.dn, type })))
    const extDn =
      tlDocsList.find((c) => extBol[c.dn]?.signed)?.dn ?? tlDocsList.find((c) => extBol[c.dn]?.exists)?.dn
    if (extDn) {
      jobs.push({ dn: extDn, type: 'customer_bol' })
    } else {
      const unknown = tlDocsList.find((c) => !extBol[c.dn])
      if (unknown) jobs.push({ dn: unknown.dn, type: 'customer_bol', optional: true })
    }
    setPrintingAll({ done: 0, total: jobs.length })
    setShipError(null)
    setPrintQueuedMsg(null)
    const failed: string[] = []
    for (const [i, job] of jobs.entries()) {
      try {
        const res = await authedPost('/api/erpnext/fulfillment/print-document', {
          dn: job.dn,
          type: job.type,
          station: printStation,
          copies,
        })
        // optional attempt on an order with no carrier BOL → expected 404, not a failure
        if (!res.ok && !(job.optional && res.status === 404)) throw new Error()
      } catch {
        failed.push(
          `${job.dn} (${
            job.type === 'bol'
              ? 'BOL'
              : job.type === 'customer_bol'
                ? t('fulfillment.customerBolShort')
                : t('fulfillment.packingShort')
          })`
        )
      }
      setPrintingAll({ done: i + 1, total: jobs.length })
    }
    setPrintingAll(null)
    if (failed.length) {
      setShipError(t('fulfillment.printAllFailed').replace('{docs}', failed.join(', ')))
    } else {
      setPrintQueuedMsg(t('fulfillment.printAllQueued'))
      setTimeout(() => setPrintQueuedMsg(null), 8000)
    }
    fetchLog()
  }

  const hasStaged = (order?.pallets?.length ?? 0) > 0
  const soFullyShipped = order?.stagingStatus === 'Shipped'
  const latestShippedDn = order?.deliveryNote?.shipped ? order.deliveryNote.name : null
  const shippedDn = justShipped?.dn ?? (soFullyShipped || !hasStaged ? latestShippedDn : null)
  const isShipped = !!shippedDn || soFullyShipped
  const prevShipments = (order?.previousShipments ?? []).filter((d) => d.name !== shippedDn)
  // BOL signature step: sign (or skip) before the documents are offered.
  const dnSigned = order?.deliveryNote?.signed ?? false
  const showSignStep = canShip && !!shippedDn && !dnSigned && !signSkipped
  const showDocs = !!shippedDn && (dnSigned || signSkipped || !canShip)

  // carrier-BOL presence for the single-order shipped view
  useEffect(() => {
    if (shippedDn) void fetchExtBol([shippedDn])
  }, [shippedDn, fetchExtBol])

  return (
    <div className="p-4 pb-44 max-w-3xl mx-auto">
      <Link
        href="/staged"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="size-4" />
        {t('fulfillment.back')}
      </Link>

      {(loading || tlLoading) && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="size-5 animate-spin" />
        </div>
      )}

      {!loading && !tlLoading && error && <p className="text-center text-destructive py-10">{error}</p>}

      {/* ─── Truckload: all orders confirmed — one signature, all documents ─── */}
      {!tlLoading && !error && tlAllDone && truckload && (
        <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-5 mb-4">
          <div className="flex items-center gap-3 mb-1">
            <CheckCircle2 className="size-10 text-emerald-600 shrink-0" />
            <div>
              <p className="text-lg font-bold text-emerald-600">{t('fulfillment.tlDone')}</p>
              <p className="text-sm text-muted-foreground">
                {truckload.load_number} · {tlDocsList.length} DN
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-3">{t('fulfillment.tlAllDone')}</p>
          <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 mb-3 flex items-start gap-2">
            <span className="text-lg leading-none">📷</span>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{t('fulfillment.photoReminder')}</p>
          </div>

          {shipError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 mb-3 text-sm text-red-600 font-semibold">
              {shipError}
            </div>
          )}

          {/* ONE signature for the whole truck — offered while ANY BOL is unsigned */}
          {!tlSignDone && !signSkipped && canShip && tlUnsignedDns.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4 mb-3">
              <p className="font-semibold mb-1">{t('fulfillment.signBolTitle')}</p>
              <p className="text-xs text-muted-foreground mb-3">
                {t('fulfillment.tlSignHint').replace('{count}', String(tlUnsignedDns.length))}
              </p>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder={t('fulfillment.driverName')}
                autoComplete="off"
                className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 mb-2"
              />
              <SignaturePad onChange={setSignature} clearLabel={t('fulfillment.clearSignature')} />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setSignSkipped(true)}
                  disabled={tlSigning}
                  className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {t('fulfillment.skipSignature')}
                </button>
                <button
                  onClick={doTlSignAll}
                  disabled={!signature || tlSigning}
                  className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {tlSigning && <RefreshCw className="size-4 animate-spin" />}
                  {tlSigning ? t('fulfillment.signSaving') : t('fulfillment.saveSignature')}
                </button>
              </div>
            </div>
          )}

          {(tlSignDone || signSkipped || !canShip || tlUnsignedDns.length === 0) && (
            <>
              {tlSignDone && (
                <p className="text-xs text-emerald-700 mb-3">
                  {t('fulfillment.signedNote').replace('{name}', driverName || '-')}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold">{t('fulfillment.tlDocsTitle')}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{t('fulfillment.copies')}</span>
                  <button
                    onClick={() => setCopies((c) => Math.max(1, c - 1))}
                    className="size-7 rounded-lg border border-border font-bold"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-sm font-bold">{copies}</span>
                  <button
                    onClick={() => setCopies((c) => Math.min(5, c + 1))}
                    className="size-7 rounded-lg border border-border font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
              {/* ONE button: packing slip + BOL for every order, ×copies each */}
              {canShip && printStations.length > 0 && (
                <div className="mb-3">
                  {printStations.length > 1 && (
                    <select
                      value={printStation}
                      onChange={(e) => setPrintStation(e.target.value)}
                      className="w-full mb-2 rounded-lg border border-border bg-background px-2 py-2 text-sm"
                    >
                      {printStations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={doPrintAllDocuments}
                    disabled={!!printingAll || !!printing || !extBolReady}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white py-3.5 text-base font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60"
                  >
                    {printingAll ? <RefreshCw className="size-5 animate-spin" /> : <Printer className="size-5" />}
                    {printingAll
                      ? t('fulfillment.printAllProgress')
                          .replace('{done}', String(printingAll.done))
                          .replace('{total}', String(printingAll.total))
                      : t('fulfillment.printAllDocs').replace(
                          '{count}',
                          String(tlDocsList.length * 2 + (tlExtDn ? 1 : 0))
                        )}
                  </button>
                  <p className="mt-1 text-center text-[11px] text-muted-foreground">
                    {t('fulfillment.printAllHint')
                      .replace('{orders}', String(tlDocsList.length))
                      .replace('{copies}', String(copies))}
                  </p>
                </div>
              )}
              <div className="space-y-2">
                {tlDocsList.map((c) => (
                  <div key={c.dn} className="rounded-xl border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground mb-1.5">
                      <span className="font-mono font-bold text-foreground">{c.so}</span> ·{' '}
                      <span className="font-mono">{c.dn}</span>
                      {dnSignedMap[c.dn] && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-600">
                          {t('fulfillment.signedBadge')}
                        </span>
                      )}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => openDocument(c.dn, 'bol')}
                        className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-bold hover:bg-primary/90 transition-colors"
                      >
                        <FileText className="size-4" />
                        {t('fulfillment.viewBol')}
                      </button>
                      <button
                        onClick={() => openDocument(c.dn, 'packing')}
                        className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 text-sm font-bold hover:bg-primary/90 transition-colors"
                      >
                        <FileText className="size-4" />
                        {t('fulfillment.viewPackingSlip')}
                      </button>
                    </div>
                    {canShip && printStations.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <button
                          onClick={() => doPrintDocument(c.dn, 'bol')}
                          disabled={!!printing}
                          className="flex items-center justify-center gap-2 rounded-xl border border-border py-2 text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <Printer className="size-3.5" />
                          {t('fulfillment.printBol')} ×{copies}
                        </button>
                        <button
                          onClick={() => doPrintDocument(c.dn, 'packing')}
                          disabled={!!printing}
                          className="flex items-center justify-center gap-2 rounded-xl border border-border py-2 text-xs font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <Printer className="size-3.5" />
                          {t('fulfillment.printPackingSlip')} ×{copies}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {/* ONE carrier BOL for the whole truckload (outside trucking) —
                  view/print once + the tap-to-place signature stamp */}
              {tlExtDn && (
                <div className="mt-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3">
                  <p className="mb-2 flex items-start gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                    <Truck className="size-4 shrink-0 mt-0.5" />
                    {t('fulfillment.extBolHandDriver')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => openDocument(tlExtDn, 'customer_bol')}
                      className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/60 bg-card py-2.5 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                    >
                      <FileText className="size-4" />
                      {t('fulfillment.viewCustomerBol')}
                    </button>
                    {canShip && printStations.length > 0 && (
                      <button
                        onClick={() => doPrintDocument(tlExtDn, 'customer_bol')}
                        disabled={!!printing}
                        className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/60 bg-card py-2.5 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                      >
                        <Printer className="size-4" />
                        {t('fulfillment.printCustomerBol')} ×{copies}
                      </button>
                    )}
                  </div>
                  {canShip && dnSignedMap[tlExtDn] && (
                    <div className="mt-2">
                      <ExternalBolSignPlacement
                        key={tlExtDn}
                        dn={tlExtDn}
                        alreadySigned={!!extBol[tlExtDn]?.signed}
                        onSigned={() => fetchExtBol([tlExtDn])}
                      />
                    </div>
                  )}
                </div>
              )}
              {printQueuedMsg && <p className="mt-2 text-xs font-semibold text-emerald-600">{printQueuedMsg}</p>}
              <Link
                href="/staged"
                className="mt-4 flex w-full items-center justify-center rounded-xl border border-border py-3 text-sm font-semibold hover:bg-muted transition-colors"
              >
                {t('fulfillment.back')}
              </Link>
            </>
          )}
        </div>
      )}

      {!loading && !error && order && (
        <>
          {/* Truckload progress (chained mode) */}
          {tlId && truckload && (
            <div className="rounded-xl border-2 border-violet-500 bg-violet-500/10 p-3 mb-3">
              <p className="font-bold text-violet-600">
                🚛{' '}
                {t('fulfillment.tlProgress')
                  .replace('{current}', String(tlPosition))
                  .replace('{total}', String(tlActiveOrders.length))
                  .replace('{tl}', truckload.load_number)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tlActiveOrders.map((o) => {
                  const done =
                    o.status === 'shipped' ||
                    tlCompleted.some((c) => (c.orderKey ? c.orderKey === o.order_key : c.so === o.so_number))
                  const current = o.order_key === tlMember?.order_key
                  const label = `${o.so_number}${o.line ? ` · L${o.line}` : ''}`
                  if (done || current) {
                    return (
                      <span
                        key={o.order_key}
                        className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                          done ? 'bg-emerald-500/15 text-emerald-600 line-through' : 'bg-violet-600 text-white'
                        }`}
                      >
                        {label}
                      </span>
                    )
                  }
                  // pending + not current -> tap to scan this one next
                  return (
                    <button
                      key={o.order_key}
                      onClick={() => setTlPickedKey(o.order_key)}
                      className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground border border-dashed border-violet-500/60 hover:bg-violet-500/10 hover:text-violet-600 transition-colors"
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              {tlActiveOrders.some(
                (o) =>
                  o.status === 'pending' &&
                  o.order_key !== tlMember?.order_key &&
                  !tlCompleted.some((c) => (c.orderKey ? c.orderKey === o.order_key : c.so === o.so_number))
              ) && <p className="mt-1.5 text-[11px] text-violet-600/80">{t('fulfillment.tlPickHint')}</p>}
              {truckload.notes && (
                <p className="mt-2 text-xs text-violet-700 dark:text-violet-300 whitespace-pre-wrap">
                  {truckload.notes}
                </p>
              )}
            </div>
          )}

          {/* Progress restored from the server after a refresh / device swap */}
          {sessionRestored && !isShipped && (
            <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-3 mb-3 text-sm font-semibold text-blue-600">
              ☁️ {t('fulfillment.sessionRestored')}
            </div>
          )}

          {/* Manager release note (order ships alone now) */}
          {releasedNote && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 mb-3 text-sm font-semibold text-amber-700">
              {t('truckload.chipReleased')} · {releasedNote}
            </div>
          )}

          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Truck className="size-6" />
              {t('fulfillment.title')}
            </h1>
            {order.stagingStatus && (
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                  order.stagingStatus === 'Staged'
                    ? 'bg-emerald-500/15 text-emerald-600'
                    : order.stagingStatus === 'Shipped'
                      ? 'bg-blue-500/15 text-blue-600'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {order.stagingStatus === 'Staged'
                  ? t('fulfillment.statusStaged')
                  : order.stagingStatus === 'Shipped'
                    ? t('fulfillment.statusShipped')
                    : order.stagingStatus}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 mb-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <p className="text-muted-foreground">{t('fulfillment.order')}</p>
                <p className="font-bold">{order.so}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('table.customer')}</p>
                <p className="font-semibold">{order.customer}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('table.po')}</p>
                <p className="font-semibold">{order.poNo || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">{t('fulfillment.deliveryDate')}</p>
                <p className="font-semibold">{order.deliveryDate || '-'}</p>
              </div>
            </div>
          </div>

          {/* Lines */}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('fulfillment.products')}
          </h2>
          <div className="space-y-2 mb-6">
            {(tlId && tlMember?.so_item
              ? order.lines.filter((l) => l.soItem === tlMember.so_item)
              : order.lines
            ).map((line) => (
              <div key={line.soItem} className="rounded-xl border border-border bg-card p-3 flex gap-3 items-center">
                {images[line.itemCode] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[line.itemCode]}
                    alt={line.itemCode}
                    className="size-16 rounded-lg object-cover bg-muted shrink-0"
                  />
                ) : (
                  <div className="size-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Package className="size-7 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-bold truncate">{line.itemCode}</p>
                  {line.itemName !== line.itemCode && (
                    <p className="text-xs text-muted-foreground truncate">{line.itemName}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-sm">
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.ordered')}: </span>
                      <span className="font-semibold">{line.orderedQty.toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.delivered')}: </span>
                      <span className="font-semibold">{line.deliveredQty.toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.staged')}: </span>
                      <span className="font-semibold">{stagedQtyFor(line).toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.scannedQty')}: </span>
                      <span
                        className={`font-semibold ${
                          scannedQtyFor(line) >= stagedQtyFor(line) && stagedQtyFor(line) > 0
                            ? 'text-emerald-600'
                            : ''
                        }`}
                      >
                        {scannedQtyFor(line).toLocaleString()}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Previous releases already shipped on this SO — each keeps its own
              documents; the current view stays focused on the ACTIVE release. */}
          {prevShipments.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-3 mb-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                {t('fulfillment.previousShipments')}
              </h3>
              <div className="divide-y divide-border">
                {prevShipments.map((d) => (
                  <div key={d.name} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-semibold">{d.name}</span>
                      {d.signed && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-600">
                          {t('fulfillment.signedBadge')}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => openDocument(d.name, 'bol')}
                        className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-xs font-semibold transition-colors"
                      >
                        BOL
                      </button>
                      <button
                        onClick={() => openDocument(d.name, 'packing')}
                        className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-xs font-semibold transition-colors"
                      >
                        {t('fulfillment.packingShort')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ship error (gate rejection etc.) */}
          {shipError && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 mb-4 text-sm text-red-600 font-semibold">
              {shipError}
            </div>
          )}

          {/* ─── Truckload hard block (single mode, decision 3) ─── */}
          {tlBlocked && truckload && !isShipped && (
            <div className="rounded-xl border-2 border-violet-500 bg-violet-500/10 p-4 mb-4">
              <p className="text-lg font-bold text-violet-600 mb-1">🚛 {t('fulfillment.tlBlockTitle')}</p>
              <p className="text-sm mb-3">
                {t('fulfillment.tlBlockBody')
                  .replace('{so}', soParam)
                  .replace('{tl}', truckload.load_number)}
              </p>
              <div className="rounded-lg border border-border bg-card divide-y divide-border mb-3">
                {tlActiveOrders.map((o) => (
                  <div key={o.order_key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className={`font-mono font-bold ${o.so_number === soParam ? 'text-violet-600' : ''}`}>
                        {o.so_number}
                        {o.line ? ` · L${o.line}` : ''}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">{o.customer}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        o.status === 'shipped' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-violet-500/15 text-violet-600'
                      }`}
                    >
                      {o.status === 'shipped' ? t('truckload.chipShipped') : t('truckload.chipPending')}
                    </span>
                  </div>
                ))}
              </div>
              {truckload.notes && (
                <p className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs mb-3 whitespace-pre-wrap">
                  <b>{t('truckload.notes')}:</b> {truckload.notes}
                </p>
              )}
              {canShip && (
                <Link
                  href={`/staged/ship?tl=${encodeURIComponent(truckload.id)}`}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-white py-3.5 text-base font-bold hover:bg-violet-700 transition-colors"
                >
                  <Truck className="size-5" />
                  {t('fulfillment.tlShipAll')}
                </Link>
              )}
              {canShip && (
                <div className="mt-3">
                  {!overrideOpen ? (
                    <button
                      onClick={() => setOverrideOpen(true)}
                      className="w-full text-center text-xs text-muted-foreground underline underline-offset-2 py-1"
                    >
                      {t('fulfillment.tlOverride')}
                    </button>
                  ) : (
                    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">{t('fulfillment.tlOverrideHint')}</p>
                      {!canManageTruckloads && (
                        <>
                          <input
                            type="email"
                            value={mgrEmail}
                            onChange={(e) => setMgrEmail(e.target.value)}
                            placeholder={t('fulfillment.tlManagerEmail')}
                            autoComplete="off"
                            className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm"
                          />
                          <input
                            type="password"
                            value={mgrPass}
                            onChange={(e) => setMgrPass(e.target.value)}
                            placeholder={t('fulfillment.tlManagerPassword')}
                            autoComplete="new-password"
                            className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm"
                          />
                        </>
                      )}
                      {overrideError && <p className="text-xs font-semibold text-red-600">{overrideError}</p>}
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setOverrideOpen(false)
                            setOverrideError(null)
                          }}
                          disabled={overriding}
                          className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {t('truckload.cancel')}
                        </button>
                        <button
                          onClick={doOverride}
                          disabled={overriding || (!canManageTruckloads && (!mgrEmail || !mgrPass))}
                          className="flex-1 rounded-xl bg-amber-600 text-white py-2.5 text-sm font-bold hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {overriding && <RefreshCw className="size-4 animate-spin" />}
                          {overriding ? t('fulfillment.tlOverrideWorking') : t('fulfillment.tlOverrideConfirm')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Shipped view */}
          {!tlId && isShipped && (
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-5 mb-4">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="size-10 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-emerald-600">
                    {soFullyShipped ? t('fulfillment.shippedTitle') : t('fulfillment.releaseShippedTitle')}
                  </p>
                  {shippedDn && <p className="text-sm text-muted-foreground">{shippedDn}</p>}
                </div>
              </div>
              {!soFullyShipped && (
                <div className="rounded-xl border border-blue-500/40 bg-blue-500/10 p-3 mb-3 text-sm text-blue-600">
                  {t('fulfillment.moreReleasesNote')}
                </div>
              )}
              {/* Reminder to capture the shipment pictures right after the load ships. */}
              <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 mb-3 flex items-start gap-2">
                <span className="text-lg leading-none">📷</span>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{t('fulfillment.photoReminder')}</p>
              </div>
              {justShipped && !justShipped.docsOk && (
                <p className="text-xs text-amber-600 mb-3">{t('fulfillment.docsPartial')}</p>
              )}

              {/* Sign the BOL before the documents are offered (skippable) */}
              {showSignStep && shippedDn && (
                <div className="rounded-xl border border-border bg-card p-4 mb-3">
                  <p className="font-semibold mb-1">{t('fulfillment.signBolTitle')}</p>
                  <p className="text-xs text-muted-foreground mb-3">{t('fulfillment.signBolHint')}</p>
                  <input
                    type="text"
                    value={driverName}
                    onChange={(e) => setDriverName(e.target.value)}
                    placeholder={t('fulfillment.driverName')}
                    autoComplete="off"
                    className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 mb-2"
                  />
                  <SignaturePad onChange={setSignature} clearLabel={t('fulfillment.clearSignature')} />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setSignSkipped(true)}
                      disabled={signing}
                      className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {t('fulfillment.skipSignature')}
                    </button>
                    <button
                      onClick={() => doSignBol(shippedDn)}
                      disabled={!signature || signing}
                      className="flex-1 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {signing && <RefreshCw className="size-4 animate-spin" />}
                      {signing ? t('fulfillment.signSaving') : t('fulfillment.saveSignature')}
                    </button>
                  </div>
                </div>
              )}

              {dnSigned && (
                <p className="text-xs text-emerald-700 mb-3">
                  {t('fulfillment.signedNote').replace('{name}', order?.deliveryNote?.driverName || '-')}
                </p>
              )}

              {/* Outside trucking: the carrier BOL leaves WITH the driver */}
              {shippedDn && extBol[shippedDn]?.exists && (
                <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 mb-3 flex items-start gap-2">
                  <Truck className="size-4 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    {t('fulfillment.extBolHandDriver')}
                  </p>
                </div>
              )}

              {/* Outside trucking: stamp the driver's signature onto the carrier's BOL */}
              {canShip && shippedDn && dnSigned && extBol[shippedDn]?.exists && (
                <div className="mb-3">
                  {/* key: a DN switch (multi-release) must remount so the loaded
                      PDF can never belong to the previous shipment */}
                  <ExternalBolSignPlacement
                    key={shippedDn}
                    dn={shippedDn}
                    alreadySigned={!!extBol[shippedDn]?.signed}
                    onSigned={() => fetchExtBol([shippedDn])}
                  />
                </div>
              )}

              {showDocs && shippedDn && (
                <>
                <div className="flex items-center justify-end gap-1.5 mb-2">
                  <span className="text-xs text-muted-foreground">{t('fulfillment.copies')}</span>
                  <button
                    onClick={() => setCopies((c) => Math.max(1, c - 1))}
                    className="size-7 rounded-lg border border-border font-bold"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-sm font-bold">{copies}</span>
                  <button
                    onClick={() => setCopies((c) => Math.min(5, c + 1))}
                    className="size-7 rounded-lg border border-border font-bold"
                  >
                    +
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => openDocument(shippedDn, 'bol')}
                    className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold hover:bg-primary/90 transition-colors"
                  >
                    <FileText className="size-4" />
                    {t('fulfillment.viewBol')}
                  </button>
                  <button
                    onClick={() => openDocument(shippedDn, 'packing')}
                    className="flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold hover:bg-primary/90 transition-colors"
                  >
                    <FileText className="size-4" />
                    {t('fulfillment.viewPackingSlip')}
                  </button>
                </div>
                {extBol[shippedDn]?.exists && (
                  <button
                    onClick={() => openDocument(shippedDn, 'customer_bol')}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 py-3 text-sm font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
                  >
                    <FileText className="size-4" />
                    {t('fulfillment.viewCustomerBol')}
                  </button>
                )}

                {/* Physical printing through the station relay (letter paper) */}
                {canShip && printStations.length > 0 && (
                  <div className="mt-3 rounded-xl border border-border bg-card/60 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {t('fulfillment.printOnPaper')}
                      </p>
                      {printStations.length > 1 ? (
                        <select
                          value={printStation}
                          onChange={(e) => setPrintStation(e.target.value)}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                        >
                          {printStations.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">{printStations[0].name}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => doPrintDocument(shippedDn, 'bol')}
                        disabled={!!printing}
                        className="flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {printing === 'bol' ? <RefreshCw className="size-4 animate-spin" /> : <Printer className="size-4" />}
                        {t('fulfillment.printBol')}
                      </button>
                      <button
                        onClick={() => doPrintDocument(shippedDn, 'packing')}
                        disabled={!!printing}
                        className="flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-semibold hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        {printing === 'packing' ? <RefreshCw className="size-4 animate-spin" /> : <Printer className="size-4" />}
                        {t('fulfillment.printPackingSlip')}
                      </button>
                    </div>
                    {extBol[shippedDn]?.exists && (
                      <button
                        onClick={() => doPrintDocument(shippedDn, 'customer_bol')}
                        disabled={!!printing}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/60 bg-amber-500/10 py-2.5 text-sm font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                      >
                        {printing === 'customer_bol' ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : (
                          <Printer className="size-4" />
                        )}
                        {t('fulfillment.printCustomerBol')}
                      </button>
                    )}
                    {printQueuedMsg && (
                      <p className="mt-2 text-xs font-semibold text-emerald-600">{printQueuedMsg}</p>
                    )}
                  </div>
                )}
                </>
              )}
              {/* Customer-provided BOL (outside trucker paperwork) */}
              {shippedDn && canShip && (
                <div className="mt-4 border-t border-emerald-500/20 pt-4">
                  <p className="text-sm font-semibold mb-1">{t('fulfillment.customerBolTitle')}</p>
                  <p className="text-xs text-muted-foreground mb-2">{t('fulfillment.customerBolHint')}</p>
                  {(order.deliveryNote?.attachments ?? [])
                    .filter((f) => f.startsWith('CustomerBOL-'))
                    .map((f) => (
                      <p key={f} className="text-xs text-emerald-700 font-mono mb-1">✓ {f}</p>
                    ))}
                  {uploadedBols.map((f) => (
                    <p key={f} className="text-xs text-emerald-700 font-mono mb-1">✓ {f}</p>
                  ))}
                  <label className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-semibold cursor-pointer hover:bg-muted transition-colors">
                    <Upload className="size-4" />
                    {uploading ? t('fulfillment.uploading') : t('fulfillment.uploadCustomerBol')}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (f) doUploadBol(shippedDn, f)
                      }}
                    />
                  </label>
                </div>
              )}
              {shippedDn && canShip && (
                <button
                  onClick={() => doUndo(shippedDn)}
                  disabled={undoing}
                  className="mt-4 w-full text-center text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                >
                  {undoing ? t('fulfillment.undoing') : t('fulfillment.undoShipment')}
                </button>
              )}
            </div>
          )}

          {/* Load log — every complete / undo / sign / upload with who + when */}
          {logEntries.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {t('fulfillment.loadLog')}
              </h2>
              <div className="rounded-xl border border-border bg-card divide-y divide-border">
                {logEntries.map((e) => (
                  <div key={e.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {t(
                          e.action === 'complete'
                            ? 'fulfillment.logComplete'
                            : e.action === 'undo'
                              ? 'fulfillment.logUndo'
                              : e.action === 'sign_bol'
                                ? 'fulfillment.logSign'
                                : e.action === 'sign_external_bol'
                                  ? 'fulfillment.logSignExternal'
                                  : e.action === 'print_document'
                                    ? 'fulfillment.logPrint'
                                    : e.action === 'move_reservation'
                                      ? 'fulfillment.logMove'
                                      : e.action === 'tl_release'
                                        ? 'fulfillment.logRelease'
                                        : 'fulfillment.logUpload'
                        )}{' '}
                        <span className="font-mono text-xs text-muted-foreground">{e.dn_number}</span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {e.user_name || '-'}
                        {e.detail ? ` · ${e.detail}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* View-only note for users without the Ship Loads permission */}
          {!isShipped && !canShip && (
            <div className="rounded-xl border border-border bg-card p-4 mb-4 text-sm text-muted-foreground">
              {t('fulfillment.viewOnly')}
            </div>
          )}

          {/* Scan progress */}
          {!isShipped && canShip && !tlBlocked && (
          <div
            className={`rounded-xl border p-4 mb-4 ${
              allMatch
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-border bg-card'
            }`}
          >
            {allMatch ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 className="size-8 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-600">{t('fulfillment.allMatch')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('fulfillment.scanProgress')
                      .replace('{scanned}', String(totalScanned))
                      .replace('{total}', String(totalStaged))}
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <p className="font-semibold">
                  {t('fulfillment.scanProgress')
                    .replace('{scanned}', String(totalScanned))
                    .replace('{total}', String(totalStaged))}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">{t('fulfillment.scanToConfirm')}</p>
              </div>
            )}
          </div>
          )}

          {/* Staged pallets — each turns green once scanned */}
          {!isShipped && !tlBlocked && (
          <>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('fulfillment.stagedPallets')} ({scopedPallets.length})
          </h2>
          {scopedPallets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('fulfillment.noPallets')}</p>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {scopedPallets.map((p) => {
                const ok = scannedOk.has(p.palletId.toUpperCase())
                return (
                  <div
                    key={p.palletId}
                    className={`flex items-center justify-between gap-3 p-3 transition-colors ${
                      ok ? 'bg-emerald-500/10' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {ok ? (
                        <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white shrink-0">
                          <Check className="size-4" />
                        </span>
                      ) : (
                        <span className="size-6 rounded-full border-2 border-muted-foreground/40 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className={`font-mono font-bold ${ok ? 'text-emerald-600' : ''}`}>{p.palletId}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.itemCode} · {p.qty.toLocaleString()} {t('fulfillment.pcs')}
                        </p>
                      </div>
                    </div>
                    {ok && (
                      <button
                        onClick={() => removeScan(p.palletId)}
                        className="text-xs text-muted-foreground underline underline-offset-2 py-2 px-1"
                      >
                        {t('fulfillment.remove')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Wrong scans */}
          {mismatches.length > 0 && (
            <>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-red-600 mt-5 mb-2">
                {t('fulfillment.mismatches')} ({mismatches.length})
              </h2>
              <div className="rounded-xl border border-red-500/40 bg-red-500/5 divide-y divide-red-500/20 overflow-hidden">
                {mismatches.map((m) => (
                  <div key={m.palletId} className="flex items-center justify-between gap-3 p-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <XCircle className="size-6 text-red-600 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono font-bold text-red-600">{m.palletId}</p>
                        <p className="text-xs text-red-600/90">{m.reason}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => removeScan(m.palletId)}
                      aria-label={t('fulfillment.remove')}
                      className="rounded-full p-2 hover:bg-red-500/10 text-red-600 shrink-0"
                    >
                      <X className="size-5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Complete Shipment (enabled by the green light) */}
          {canShip && (
          <button
            disabled={!allMatch}
            onClick={() => setConfirmOpen(true)}
            className="mt-6 w-full rounded-xl bg-emerald-600 text-white py-4 text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
          >
            {t('fulfillment.completeShipment')}
          </button>
          )}
          </>
          )}
        </>
      )}

      {/* Sticky scan bar */}
      {!loading && !error && order && !isShipped && canShip && !tlBlocked && scopedPallets.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="max-w-3xl mx-auto space-y-2">
            {feedback && (
              <div
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  feedback.ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600'
                }`}
              >
                {feedback.text}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setScannerOpen(true)
                  setScanKey((k) => k + 1)
                }}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3.5 text-base font-bold hover:bg-primary/90 transition-colors"
              >
                <Camera className="size-5" />
                {t('fulfillment.scanPallet')}
              </button>
              <button
                onClick={() => setTypedOpen((v) => !v)}
                aria-label={t('fulfillment.typePalletId')}
                className={`rounded-xl border border-border px-4 ${typedOpen ? 'bg-muted' : 'bg-card'}`}
              >
                <Keyboard className="size-5" />
              </button>
            </div>
            {typedOpen && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitTyped()
                  }}
                  placeholder={t('fulfillment.typePalletId')}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 rounded-lg border border-border bg-muted px-3 py-2.5 font-mono"
                />
                <button
                  onClick={submitTyped}
                  disabled={!typed.trim()}
                  className="rounded-lg bg-primary text-primary-foreground px-4 font-semibold disabled:opacity-40"
                >
                  {t('fulfillment.add')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Camera scanner (remounted per decode -> continuous scanning) */}
      {scannerOpen && (
        <>
          <PalletScanner
            key={scanKey}
            onClose={() => setScannerOpen(false)}
            onResult={(code) => {
              const now = Date.now()
              if (lastScanRef.current.code === code && now - lastScanRef.current.at < 2500) {
                setScanKey((k) => k + 1)
                return
              }
              lastScanRef.current = { code, at: now }
              processScan(code)
              setScanKey((k) => k + 1) // restart the camera for the next pallet
            }}
          />
          {/* Live result strip over the camera */}
          {feedback && (
            <div className="fixed bottom-24 left-4 right-4 z-[60]">
              <div
                className={`mx-auto max-w-md rounded-xl px-4 py-3 text-center text-base font-bold shadow-lg ${
                  feedback.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                }`}
              >
                {feedback.text}
              </div>
            </div>
          )}
        </>
      )}

      {/* Final confirmation prompt */}
      {confirmOpen && order && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border p-5">
            <h3 className="text-lg font-bold mb-2">{t('fulfillment.confirmTitle')}</h3>
            <p className="text-sm text-muted-foreground mb-3">
              {t('fulfillment.confirmBody')
                .replace('{count}', String(totalScanned))
                .replace('{so}', order.so)
                .replace('{customer}', order.customer)}
            </p>
            <div className="rounded-lg bg-muted/50 divide-y divide-border mb-4 max-h-48 overflow-y-auto">
              {scopedPallets
                .filter((p) => scannedOk.has(p.palletId.toUpperCase()))
                .map((p) => (
                  <div key={p.palletId} className="flex justify-between px-3 py-2 text-sm">
                    <span className="font-mono font-semibold">{p.palletId}</span>
                    <span>
                      {p.itemCode} · {p.qty.toLocaleString()} {t('fulfillment.pcs')}
                    </span>
                  </div>
                ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="flex-1 rounded-xl border border-border py-3 font-semibold hover:bg-muted transition-colors disabled:opacity-50"
              >
                {t('fulfillment.confirmCancel')}
              </button>
              <button
                onClick={doComplete}
                disabled={submitting}
                className="flex-1 rounded-xl bg-emerald-600 text-white py-3 font-bold hover:bg-emerald-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {submitting && <RefreshCw className="size-4 animate-spin" />}
                {submitting ? t('fulfillment.submitting') : t('fulfillment.confirmSubmit')}
              </button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-3">{t('fulfillment.submitNote')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
