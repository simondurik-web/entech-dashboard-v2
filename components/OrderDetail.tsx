'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Ruler } from 'lucide-react'
import type { PalletRecord, ShippingRecord, Drawing } from '@/lib/google-sheets'

interface OrderDetailProps {
  ifNumber?: string
  line?: string
  isShipped?: boolean
  shippedDate?: string
  tirePartNum?: string
  hubPartNum?: string
  partNumber?: string
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
  tirePartNum,
  hubPartNum,
  partNumber,
  onClose,
}: OrderDetailProps) {
  const [pallets, setPallets] = useState<PalletRecord[]>([])
  const [shipping, setShipping] = useState<ShippingRecord | null>(null)
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function run() {
      try {
        setLoading(true)
        setError(null)

        const requests: Promise<Response>[] = [
          fetch('/api/pallet-records'),
          fetch('/api/drawings'),
        ]
        if (isShipped) requests.push(fetch('/api/shipping-records'))

        const responses = await Promise.all(requests)
        const [palletRes, drawingsRes, shippingRes] = responses
        
        if (!palletRes.ok) throw new Error('Failed to fetch pallet records')
        if (!drawingsRes.ok) throw new Error('Failed to fetch drawings')
        if (shippingRes && !shippingRes.ok) throw new Error('Failed to fetch shipping records')

        const palletData = (await palletRes.json()) as PalletRecord[]
        const drawingsData = (await drawingsRes.json()) as Drawing[]
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
        setDrawings(drawingsData)
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

  // Find matching drawings for tire and hub parts
  const matchedDrawings = useMemo(() => {
    const result: { tire: Drawing | null; hub: Drawing | null; main: Drawing | null } = {
      tire: null,
      hub: null,
      main: null,
    }

    if (!drawings.length) return result

    // Try to find by tire part number
    if (tirePartNum) {
      const tireNorm = tirePartNum.trim().toUpperCase()
      result.tire = drawings.find((d) => d.partNumber.toUpperCase() === tireNorm) || null
    }

    // Try to find by hub part number
    if (hubPartNum) {
      const hubNorm = hubPartNum.trim().toUpperCase()
      result.hub = drawings.find((d) => d.partNumber.toUpperCase() === hubNorm) || null
    }

    // Try to find by main part number
    if (partNumber) {
      const partNorm = partNumber.trim().toUpperCase()
      result.main = drawings.find((d) => d.partNumber.toUpperCase() === partNorm) || null
    }

    return result
  }, [drawings, tirePartNum, hubPartNum, partNumber])

  const hasDrawings = matchedDrawings.tire || matchedDrawings.hub || matchedDrawings.main

  return (
    <>
      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300"
            >
              <X className="h-6 w-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt="Drawing"
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
          </div>
        </div>
      )}

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
            Loading order details...
          </div>
        )}

        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && (
          <div className="space-y-3">
            {/* Drawings Section */}
            {hasDrawings && (
              <div className="rounded-md border bg-background/60 p-3">
                <p className="mb-2 text-sm font-semibold flex items-center gap-2">
                  <Ruler className="h-4 w-4" />
                  Drawings
                </p>
                <div className="flex flex-wrap gap-4">
                  {matchedDrawings.main && (matchedDrawings.main.drawing1Url || matchedDrawings.main.drawing2Url) && (
                    <div className="flex flex-col items-center">
                      {matchedDrawings.main.drawing1Url && (
                        <button
                          onClick={() => setLightboxUrl(matchedDrawings.main!.drawing1Url)}
                          className="cursor-pointer overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-primary transition-all"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={matchedDrawings.main.drawing1Url}
                            alt={`${matchedDrawings.main.partNumber} drawing`}
                            className="h-24 w-auto object-contain"
                          />
                        </button>
                      )}
                      <span className="text-xs text-muted-foreground mt-1">{matchedDrawings.main.partNumber}</span>
                    </div>
                  )}
                  {matchedDrawings.tire && (matchedDrawings.tire.drawing1Url || matchedDrawings.tire.drawing2Url) && (
                    <div className="flex flex-col items-center">
                      {matchedDrawings.tire.drawing1Url && (
                        <button
                          onClick={() => setLightboxUrl(matchedDrawings.tire!.drawing1Url)}
                          className="cursor-pointer overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-primary transition-all"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={matchedDrawings.tire.drawing1Url}
                            alt={`Tire: ${matchedDrawings.tire.partNumber}`}
                            className="h-24 w-auto object-contain"
                          />
                        </button>
                      )}
                      <span className="text-xs text-muted-foreground mt-1">Tire: {matchedDrawings.tire.partNumber}</span>
                    </div>
                  )}
                  {matchedDrawings.hub && (matchedDrawings.hub.drawing1Url || matchedDrawings.hub.drawing2Url) && (
                    <div className="flex flex-col items-center">
                      {matchedDrawings.hub.drawing1Url && (
                        <button
                          onClick={() => setLightboxUrl(matchedDrawings.hub!.drawing1Url)}
                          className="cursor-pointer overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-primary transition-all"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={matchedDrawings.hub.drawing1Url}
                            alt={`Hub: ${matchedDrawings.hub.partNumber}`}
                            className="h-24 w-auto object-contain"
                          />
                        </button>
                      )}
                      <span className="text-xs text-muted-foreground mt-1">Hub: {matchedDrawings.hub.partNumber}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pallet Records Section */}
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
                          <button
                            key={`${photo}-${photoIndex}`}
                            onClick={() => setLightboxUrl(photo)}
                            className="aspect-square overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-primary transition-all"
                            aria-label={`Pallet photo ${photoIndex + 1}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photo}
                              alt={`Pallet photo ${photoIndex + 1}`}
                              className="h-full w-full object-cover"
                            />
                          </button>
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
    </>
  )
}

export default OrderDetail
