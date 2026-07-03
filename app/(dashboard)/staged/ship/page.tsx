'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Package, RefreshCw, Truck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useI18n } from '@/lib/i18n'

// Ship Order — fulfillment wrapper, Phase 1 (read-only).
// Shows one staged Sales Order the way the shipping floor thinks about it:
// what's on the order, what's already staged (pallets), what's been delivered.
// NO dollar amounts anywhere on this screen, by design (Simon 2026-07-02).
// Scanning + Complete Shipment arrive in Phases 2–3.

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

  // Same authed-fetch pattern as inventory-ops: verified Supabase session token
  // as a Bearer header; refresh once and retry on a 401 so an expired token
  // doesn't strand a logged-in user.
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

  // Release blob URLs when leaving the page.
  useEffect(() => {
    return () => {
      Object.values(imagesRef.current).forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const stagedQtyFor = (itemCode: string) =>
    (order?.pallets ?? []).filter((p) => p.itemCode === itemCode).reduce((s, p) => s + p.qty, 0)

  return (
    <div className="p-4 pb-20 max-w-3xl mx-auto">
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

      {!loading && error && (
        <p className="text-center text-destructive py-10">{error}</p>
      )}

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

          {/* Phase-1 note */}
          <p className="text-xs text-muted-foreground mb-4">{t('fulfillment.readOnlyNote')}</p>

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
                  <div className="flex gap-4 mt-1 text-sm">
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.ordered')}: </span>
                      <span className="font-semibold">{line.orderedQty.toLocaleString()}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">{t('fulfillment.staged')}: </span>
                      <span className="font-semibold">{stagedQtyFor(line.itemCode).toLocaleString()}</span>
                    </span>
                    {line.deliveredQty > 0 && (
                      <span>
                        <span className="text-muted-foreground">{t('fulfillment.delivered')}: </span>
                        <span className="font-semibold">{line.deliveredQty.toLocaleString()}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Staged pallets */}
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {t('fulfillment.stagedPallets')} ({order.pallets.length})
          </h2>
          {order.pallets.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">{t('fulfillment.noPallets')}</p>
          ) : (
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {order.pallets.map((p) => (
                <div key={p.palletId} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-mono font-bold">{p.palletId}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.itemCode} · {p.warehouse}
                    </p>
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap">
                    {p.qty.toLocaleString()} {t('fulfillment.pcs')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
