'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { PalletRecord, ShippingRecord } from '@/lib/google-sheets'

interface OrderDetailProps {
  ifNumber?: string
  line?: string
  isShipped?: boolean
  shippedDate?: string
  onClose: () => void
}

function normalize(value: string | undefined): string {
  return (value || '').trim().toLowerCase()
}

export function OrderDetail({
  ifNumber,
  line,
  isShipped = false,
  shippedDate,
  onClose,
}: OrderDetailProps) {
  const [pallets, setPallets] = useState<PalletRecord[]>([])
  const [shipping, setShipping] = useState<ShippingRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function run() {
      try {
        setLoading(true)
        setError(null)

        const requests: Promise<Response>[] = [fetch('/api/pallet-records')]
        if (isShipped) requests.push(fetch('/api/shipping-records'))

        const [palletRes, shippingRes] = await Promise.all(requests)
        if (!palletRes.ok) throw new Error('Failed to fetch pallet records')
        if (shippingRes && !shippingRes.ok) throw new Error('Failed to fetch shipping records')

        const palletData = (await palletRes.json()) as PalletRecord[]
        const shippingData = shippingRes ? ((await shippingRes.json()) as ShippingRecord[]) : []
        const targetIf = normalize(ifNumber)
        const targetLine = normalize(line)

        const matchingPallets = palletData.filter((record) => {
          const recordIf = normalize(record.ifNumber)
          const orderNumber = normalize(record.orderNumber)
          if (targetIf && recordIf && recordIf === targetIf) return true
          if (targetLine && orderNumber && orderNumber === targetLine) return true
          return false
        })

        const matchingShipping = shippingData.find((record) => normalize(record.ifNumber) === targetIf) || null

        if (!mounted) return
        setPallets(matchingPallets)
        setShipping(matchingShipping)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Failed to load order details')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    run()
    return () => {
      mounted = false
    }
  }, [ifNumber, line, isShipped])

  const photoCount = useMemo(
    () => pallets.reduce((total, pallet) => total + pallet.photos.length, 0),
    [pallets]
  )

  return (
    <div className="rounded-md border bg-card/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Order details</p>
          <p className="text-xs text-muted-foreground">
            IF# {ifNumber || '-'} {line ? `• Line ${line}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
          aria-label="Collapse order details"
        >
          <span className="inline-flex items-center gap-1">
            <X className="size-3.5" />
            Close
          </span>
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading pallet details...
        </div>
      )}

      {!loading && error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && (
        <div className="space-y-3">
          {pallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pallet records found for this order.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {pallets.length} pallet record{pallets.length === 1 ? '' : 's'} • {photoCount} photo{photoCount === 1 ? '' : 's'}
              </p>
              {pallets.map((pallet, idx) => (
                <div key={`${pallet.timestamp}-${idx}`} className="rounded-md border bg-background/60 p-3">
                  <div className="grid gap-2 text-xs sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground">Pallet #</span>
                      <p className="font-semibold">{pallet.palletNumber || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Weight</span>
                      <p className="font-semibold">{pallet.weight || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Dimensions</span>
                      <p className="font-semibold">{pallet.dimensions || '-'}</p>
                    </div>
                  </div>
                  {pallet.photos.length > 0 && (
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {pallet.photos.map((photo, photoIndex) => (
                        <a
                          key={`${photo}-${photoIndex}`}
                          href={photo}
                          target="_blank"
                          rel="noreferrer"
                          className="aspect-square overflow-hidden rounded-md border bg-muted"
                          aria-label={`Pallet photo ${photoIndex + 1}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photo}
                            alt={`Pallet photo ${photoIndex + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {isShipped && (
            <div className="rounded-md border bg-background/60 p-3">
              <p className="mb-2 text-sm font-semibold">Shipping details</p>
              {shipping ? (
                <div className="grid gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-muted-foreground">Shipped</span>
                    <p className="font-semibold">{shipping.shipDate || shippedDate || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Carrier</span>
                    <p className="font-semibold">{shipping.carrier || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">BOL</span>
                    <p className="font-semibold">{shipping.bol || '-'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Pallet count</span>
                    <p className="font-semibold">{shipping.palletCount || 0}</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Shipped</span>
                    <p className="font-semibold">{shippedDate || '-'}</p>
                  </div>
                  <p className="text-muted-foreground">No shipping record matched this IF#.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default OrderDetail
