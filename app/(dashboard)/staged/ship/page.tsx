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
  Keyboard,
  Package,
  RefreshCw,
  Truck,
  X,
  XCircle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'

// Ship Order — fulfillment wrapper, Phases 1+2.
// Phase 1: read-only order view (lines, staged pallets). Phase 2: scan/type each
// pallet to confirm the load — per-pallet green when it matches the order's
// staged records, red with a reason when it doesn't, remove for wrong scans,
// green "everything matches" light, and a final confirmation prompt. The actual
// ERPNext submission (Delivery Note + BOL) is Phase 3.
// NO dollar amounts anywhere on this screen, by design (Simon 2026-07-02).
// Designed iPhone-first: big tap targets, sticky scan bar, camera scanner.

const PalletScanner = dynamic(() => import('@/components/inventory/PalletScanner'), { ssr: false })

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
}

interface PalletLookup {
  palletId: string
  itemCode: string | null
  disabled: boolean
  onHandQty: number
  reservedTo: { so: string; customer: string | null } | null
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
  const searchParams = useSearchParams()
  const so = (searchParams.get('so') ?? '').trim()

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
    else {
      setLoading(false)
      setError(t('fulfillment.notFound'))
    }
  }, [so, fetchOrder, t])

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

  const stagedIds = useMemo(() => new Set((order?.pallets ?? []).map((p) => p.palletId)), [order])
  const lineItemCodes = useMemo(() => new Set((order?.lines ?? []).map((l) => l.itemCode)), [order])

  const stagedQtyFor = (itemCode: string) =>
    (order?.pallets ?? []).filter((p) => p.itemCode === itemCode).reduce((s, p) => s + p.qty, 0)
  const scannedQtyFor = (itemCode: string) =>
    (order?.pallets ?? [])
      .filter((p) => p.itemCode === itemCode && scannedOk.has(p.palletId))
      .reduce((s, p) => s + p.qty, 0)

  const totalStaged = order?.pallets.length ?? 0
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

  return (
    <div className="p-4 pb-44 max-w-3xl mx-auto">
      <Link
        href="/staged"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="size-4" />
        {t('fulfillment.back')}
      </Link>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="size-5 animate-spin" />
        </div>
      )}

      {!loading && error && <p className="text-center text-destructive py-10">{error}</p>}

      {!loading && !error && order && (
        <>
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
            {order.lines.map((line) => (
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
                      <span className="text-muted-foreground">{t('fulfillment.staged')}: </span>
                      <span className="font-semibold">{stagedQtyFor(line.itemCode).toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.scannedQty')}: </span>
                      <span
                        className={`font-semibold ${
                          scannedQtyFor(line.itemCode) >= stagedQtyFor(line.itemCode) && stagedQtyFor(line.itemCode) > 0
                            ? 'text-emerald-600'
                            : ''
                        }`}
                      >
                        {scannedQtyFor(line.itemCode).toLocaleString()}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Scan progress */}
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

          {/* Staged pallets — each turns green once scanned */}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('fulfillment.stagedPallets')} ({order.pallets.length})
          </h2>
          {order.pallets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('fulfillment.noPallets')}</p>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
              {order.pallets.map((p) => {
                const ok = scannedOk.has(p.palletId)
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
          <button
            disabled={!allMatch}
            onClick={() => setConfirmOpen(true)}
            className="mt-6 w-full rounded-xl bg-emerald-600 text-white py-4 text-base font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
          >
            {t('fulfillment.completeShipment')}
          </button>
        </>
      )}

      {/* Sticky scan bar */}
      {!loading && !error && order && order.pallets.length > 0 && (
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
              {order.pallets
                .filter((p) => scannedOk.has(p.palletId))
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
                className="flex-1 rounded-xl border border-border py-3 font-semibold hover:bg-muted transition-colors"
              >
                {t('fulfillment.confirmCancel')}
              </button>
              <button
                disabled
                className="flex-1 rounded-xl bg-emerald-600 text-white py-3 font-bold opacity-40 cursor-not-allowed"
              >
                {t('fulfillment.confirmSubmit')}
              </button>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-3">{t('fulfillment.submitComingSoon')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
