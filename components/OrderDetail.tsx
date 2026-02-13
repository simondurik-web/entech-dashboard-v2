'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Ruler, Package, FileText, Truck, Search } from 'lucide-react'
import type { PalletRecord, ShippingRecord, StagedRecord, Drawing } from '@/lib/google-sheets'
import { PhotoGrid } from '@/components/ui/PhotoGrid'

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
  const [shipping, setShipping] = useState<ShippingRecord[]>([])
  const [staged, setStaged] = useState<StagedRecord[]>([])
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
          fetch('/api/staged-records'),
        ]
        if (isShipped) requests.push(fetch('/api/shipping-records'))

        const responses = await Promise.all(requests)
        const [palletRes, drawingsRes, stagedRes, shippingRes] = responses

        if (!palletRes.ok) throw new Error('Failed to fetch pallet records')
        if (!drawingsRes.ok) throw new Error('Failed to fetch drawings')
        if (!stagedRes.ok) throw new Error('Failed to fetch staged records')
        if (shippingRes && !shippingRes.ok) throw new Error('Failed to fetch shipping records')

        const palletData = (await palletRes.json()) as PalletRecord[]
        const drawingsData = (await drawingsRes.json()) as Drawing[]
        const stagedData = (await stagedRes.json()) as StagedRecord[]
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

        const matchingStaged = stagedData.filter((record) => normalize(record.ifNumber) === targetIf)
        const matchingShipping = shippingData.filter((record) => normalize(record.ifNumber) === targetIf)

        if (!mounted) return
        setPallets(matchingPallets)
        setStaged(matchingStaged)
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

  // Aggregate photos by category
  const photoCategories = useMemo(() => {
    const palletPhotos = pallets.flatMap((p) => p.photos)
    const fusionPhotos = staged.flatMap((s) => s.fusionPhotos || [])
    const shipmentPhotos = shipping.flatMap((s) => [...(s.shipmentPhotos || []), ...(s.photos || [])])
    const paperworkPhotos = shipping.flatMap((s) => s.paperworkPhotos || [])
    const closeUpPhotos = shipping.flatMap((s) => s.closeUpPhotos || [])

    return { palletPhotos, fusionPhotos, shipmentPhotos, paperworkPhotos, closeUpPhotos }
  }, [pallets, staged, shipping])

  // Find matching drawings
  const matchedDrawings = useMemo(() => {
    const result: { tire: Drawing | null; hub: Drawing | null; main: Drawing | null } = {
      tire: null,
      hub: null,
      main: null,
    }
    if (!drawings.length) return result

    if (tirePartNum) {
      const tireNorm = tirePartNum.trim().toUpperCase()
      result.tire = drawings.find((d) => d.partNumber.toUpperCase() === tireNorm) || null
    }
    if (hubPartNum) {
      const hubNorm = hubPartNum.trim().toUpperCase()
      result.hub = drawings.find((d) => d.partNumber.toUpperCase() === hubNorm) || null
    }
    if (partNumber) {
      const partNorm = partNumber.trim().toUpperCase()
      result.main = drawings.find((d) => d.partNumber.toUpperCase() === partNorm) || null
    }
    return result
  }, [drawings, tirePartNum, hubPartNum, partNumber])

  const hasDrawings = matchedDrawings.tire || matchedDrawings.hub || matchedDrawings.main
  const firstShipping = shipping[0] || null

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
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Order Details</p>
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
          <div className="space-y-4">
            {/* ===== 4-Column Photo Drilldown Grid ===== */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* BOX 1: Pallet Details (Blue) */}
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4" style={{ borderTop: '4px solid rgb(59, 130, 246)' }}>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-400">
                  <Package className="size-4" />
                  📦 Pallet Details
                </h4>
                {photoCategories.palletPhotos.length > 0 ? (
                  <>
                    <PhotoGrid photos={photoCategories.palletPhotos} maxVisible={4} size="sm" />
                    <div className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
                      {pallets.map((p, idx) => (
                        <p key={idx}>
                          #{p.palletNumber || idx + 1}: {p.weight || '-'}lbs, {p.dimensions || '-'}
                        </p>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No pallet photos available</p>
                )}
              </div>

              {/* BOX 2: Fusion Pictures (Teal) */}
              <div className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-4" style={{ borderTop: '4px solid rgb(20, 184, 166)' }}>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-teal-400">
                  <FileText className="size-4" />
                  📄 Fusion Pictures
                </h4>
                {photoCategories.fusionPhotos.length > 0 ? (
                  <PhotoGrid photos={photoCategories.fusionPhotos} maxVisible={4} size="sm" />
                ) : (
                  <p className="text-xs text-muted-foreground">No fusion pictures available</p>
                )}
              </div>

              {/* BOX 3: Shipment & Paperwork (Green) */}
              <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4" style={{ borderTop: '4px solid rgb(34, 197, 94)' }}>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-green-400">
                  <Truck className="size-4" />
                  🚚 Shipment Photos
                </h4>
                {photoCategories.shipmentPhotos.length > 0 || photoCategories.paperworkPhotos.length > 0 ? (
                  <div className="space-y-2">
                    {photoCategories.shipmentPhotos.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] text-muted-foreground">Shipment:</p>
                        <PhotoGrid photos={photoCategories.shipmentPhotos} maxVisible={3} size="sm" />
                      </div>
                    )}
                    {photoCategories.paperworkPhotos.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] text-muted-foreground">Paperwork:</p>
                        <PhotoGrid photos={photoCategories.paperworkPhotos} maxVisible={3} size="sm" />
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No shipment photos available</p>
                )}
              </div>

              {/* BOX 4: Close-Up Pictures (Purple) */}
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4" style={{ borderTop: '4px solid rgb(168, 85, 247)' }}>
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-purple-400">
                  <Search className="size-4" />
                  🔍 Close-Up Pictures
                </h4>
                {photoCategories.closeUpPhotos.length > 0 ? (
                  <PhotoGrid photos={photoCategories.closeUpPhotos} maxVisible={4} size="sm" />
                ) : (
                  <p className="text-xs text-muted-foreground">No close-up pictures available</p>
                )}
              </div>
            </div>

            {/* ===== Drawings Section ===== */}
            {hasDrawings && (
              <div className="rounded-md border bg-background/60 p-3">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Ruler className="h-4 w-4" />
                  Drawings
                </p>
                <div className="flex flex-wrap gap-4">
                  {matchedDrawings.main && matchedDrawings.main.drawing1Url && (
                    <div className="flex flex-col items-center">
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
                      <span className="mt-1 text-xs text-muted-foreground">{matchedDrawings.main.partNumber}</span>
                    </div>
                  )}
                  {matchedDrawings.tire && matchedDrawings.tire.drawing1Url && (
                    <div className="flex flex-col items-center">
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
                      <span className="mt-1 text-xs text-muted-foreground">Tire: {matchedDrawings.tire.partNumber}</span>
                    </div>
                  )}
                  {matchedDrawings.hub && matchedDrawings.hub.drawing1Url && (
                    <div className="flex flex-col items-center">
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
                      <span className="mt-1 text-xs text-muted-foreground">Hub: {matchedDrawings.hub.partNumber}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== Shipping Details (for shipped orders) ===== */}
            {isShipped && (
              <div className="rounded-md border bg-background/60 p-3">
                <p className="mb-2 text-sm font-semibold">Shipping Details</p>
                {firstShipping ? (
                  <div className="grid gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground">Shipped</span>
                      <p className="font-semibold">{firstShipping.shipDate || shippedDate || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Carrier</span>
                      <p className="font-semibold">{firstShipping.carrier || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">BOL</span>
                      <p className="font-semibold">{firstShipping.bol || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pallet Count</span>
                      <p className="font-semibold">{firstShipping.palletCount || 0}</p>
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

            {/* ===== Pallet Records Detail ===== */}
            {pallets.length > 0 && (
              <div className="rounded-md border bg-background/60 p-3">
                <p className="mb-2 text-sm font-semibold">
                  Pallet Records ({pallets.length} pallet{pallets.length === 1 ? '' : 's'})
                </p>
                <div className="space-y-2">
                  {pallets.map((pallet, idx) => (
                    <div key={`${pallet.timestamp}-${idx}`} className="rounded border bg-background/40 p-2">
                      <div className="grid gap-2 text-xs sm:grid-cols-4">
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
                        <div>
                          <span className="text-muted-foreground">Parts/Pallet</span>
                          <p className="font-semibold">{pallet.partsPerPallet || '-'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export default OrderDetail
