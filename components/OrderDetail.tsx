'use client'

import { useEffect, useMemo, useState } from 'react'
import { X, Ruler, Package, FileText, Truck, Search, ChevronDown, ChevronUp } from 'lucide-react'
import type { PalletRecord, ShippingRecord, StagedRecord, Drawing } from '@/lib/google-sheets'
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { getDriveThumbUrl } from '@/lib/drive-utils'

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

/** Compact stat chip */
function Chip({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold ${accent || ''}`}>{value}</span>
    </div>
  )
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
  const [showAllPallets, setShowAllPallets] = useState(false)

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

        if (!mounted) return
        setPallets(palletData.filter((r) => {
          const rIf = normalize(r.ifNumber)
          const oNum = normalize(r.orderNumber)
          if (targetIf && rIf && rIf === targetIf) return true
          if (targetLine && oNum && oNum === targetLine) return true
          return false
        }))
        setStaged(stagedData.filter((r) => normalize(r.ifNumber) === targetIf))
        setShipping(shippingData.filter((r) => normalize(r.ifNumber) === targetIf))
        setDrawings(drawingsData)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    run()
    return () => { mounted = false }
  }, [ifNumber, line, isShipped])

  const photoCategories = useMemo(() => {
    const palletPhotos = pallets.flatMap((p) => p.photos)
    const fusionPhotos = staged.flatMap((s) => s.fusionPhotos || [])
    const shipmentPhotos = shipping.flatMap((s) => [...(s.shipmentPhotos || []), ...(s.photos || [])])
    const paperworkPhotos = shipping.flatMap((s) => s.paperworkPhotos || [])
    const closeUpPhotos = shipping.flatMap((s) => s.closeUpPhotos || [])
    return { palletPhotos, fusionPhotos, shipmentPhotos, paperworkPhotos, closeUpPhotos }
  }, [pallets, staged, shipping])

  const matchedDrawings = useMemo(() => {
    const result: { tire: Drawing | null; hub: Drawing | null; main: Drawing | null } = { tire: null, hub: null, main: null }
    if (!drawings.length) return result
    if (tirePartNum) {
      const n = tirePartNum.trim().toUpperCase()
      result.tire = drawings.find((d) => d.partNumber.toUpperCase() === n) || null
    }
    if (hubPartNum) {
      const n = hubPartNum.trim().toUpperCase()
      result.hub = drawings.find((d) => d.partNumber.toUpperCase() === n) || null
    }
    if (partNumber) {
      const n = partNumber.trim().toUpperCase()
      result.main = drawings.find((d) => d.partNumber.toUpperCase() === n) || null
    }
    return result
  }, [drawings, tirePartNum, hubPartNum, partNumber])

  const hasDrawings = matchedDrawings.tire || matchedDrawings.hub || matchedDrawings.main
  const firstShipping = shipping[0] || null

  // Pallet summary
  const totalWeight = pallets.reduce((s, p) => s + (parseFloat(String(p.weight)) || 0), 0)
  const totalParts = pallets.reduce((s, p) => s + (parseInt(String(p.partsPerPallet)) || 0), 0)
  const firstDim = pallets[0]?.dimensions || '-'
  const visiblePallets = showAllPallets ? pallets : pallets.slice(0, 3)

  return (
    <>
      {/* Lightbox */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightboxUrl(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <button onClick={() => setLightboxUrl(null)} className="absolute -top-10 right-0 text-white hover:text-gray-300">
              <X className="h-6 w-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightboxUrl} alt="Drawing" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
          </div>
        </div>
      )}

      <div className="rounded-lg border bg-card/80 backdrop-blur-sm p-3 animate-in slide-in-from-top-2 duration-200">
        {/* ── Header row ── */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold">Order Details</p>
            <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              IF# {ifNumber || '-'} {line ? `• Line ${line}` : ''}
            </span>
          </div>
          <button onClick={onClose} className="rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted transition-colors">
            <span className="inline-flex items-center gap-1"><X className="size-3" /> Close</span>
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading...
          </div>
        )}

        {!loading && error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && (
          <div className="space-y-3">
            {/* ── Summary chips (pallet stats + shipping) ── */}
            {(pallets.length > 0 || isShipped) && (
              <div className="flex flex-wrap items-center gap-4 px-2 py-1.5 bg-muted/40 rounded-md text-xs">
                {pallets.length > 0 && (
                  <>
                    <Chip label="Pallets" value={pallets.length} />
                    <Chip label="Total Wt" value={`${totalWeight.toLocaleString()} lbs`} />
                    <Chip label="Dims" value={firstDim} />
                    <Chip label="Parts/Pallet" value={pallets[0]?.partsPerPallet || '-'} />
                    <Chip label="Total Parts" value={totalParts.toLocaleString()} />
                  </>
                )}
                {isShipped && firstShipping && (
                  <>
                    <span className="w-px h-4 bg-border" />
                    <Chip label="Shipped" value={firstShipping.shipDate || shippedDate || '-'} />
                    <Chip label="Carrier" value={firstShipping.carrier || '-'} />
                    <Chip label="BOL" value={firstShipping.bol || '-'} />
                  </>
                )}
              </div>
            )}

            {/* ── Photos — compact horizontal strip ── */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
              {/* Pallet Photos */}
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5" style={{ borderTopWidth: 2, borderTopColor: 'rgb(59, 130, 246)' }}>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 mb-2">
                  <Package className="size-3" /> Pallet
                  {photoCategories.palletPhotos.length > 0 && (
                    <span className="ml-auto text-[10px] bg-blue-500/20 px-1.5 py-0.5 rounded">{photoCategories.palletPhotos.length}</span>
                  )}
                </h4>
                {photoCategories.palletPhotos.length > 0 ? (
                  <PhotoGrid photos={photoCategories.palletPhotos} maxVisible={4} size="sm" />
                ) : (
                  <p className="text-[10px] text-muted-foreground">No photos</p>
                )}
              </div>

              {/* Fusion */}
              <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-2.5" style={{ borderTopWidth: 2, borderTopColor: 'rgb(20, 184, 166)' }}>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-teal-400 mb-2">
                  <FileText className="size-3" /> Fusion
                  {photoCategories.fusionPhotos.length > 0 && (
                    <span className="ml-auto text-[10px] bg-teal-500/20 px-1.5 py-0.5 rounded">{photoCategories.fusionPhotos.length}</span>
                  )}
                </h4>
                {photoCategories.fusionPhotos.length > 0 ? (
                  <PhotoGrid photos={photoCategories.fusionPhotos} maxVisible={4} size="sm" />
                ) : (
                  <p className="text-[10px] text-muted-foreground">No photos</p>
                )}
              </div>

              {/* Shipment */}
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-2.5" style={{ borderTopWidth: 2, borderTopColor: 'rgb(34, 197, 94)' }}>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-green-400 mb-2">
                  <Truck className="size-3" /> Shipment
                  {(photoCategories.shipmentPhotos.length + photoCategories.paperworkPhotos.length) > 0 && (
                    <span className="ml-auto text-[10px] bg-green-500/20 px-1.5 py-0.5 rounded">{photoCategories.shipmentPhotos.length + photoCategories.paperworkPhotos.length}</span>
                  )}
                </h4>
                {photoCategories.shipmentPhotos.length > 0 || photoCategories.paperworkPhotos.length > 0 ? (
                  <div className="space-y-1">
                    {photoCategories.shipmentPhotos.length > 0 && <PhotoGrid photos={photoCategories.shipmentPhotos} maxVisible={3} size="sm" />}
                    {photoCategories.paperworkPhotos.length > 0 && <PhotoGrid photos={photoCategories.paperworkPhotos} maxVisible={2} size="sm" />}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground">No photos</p>
                )}
              </div>

              {/* Close-Up */}
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5" style={{ borderTopWidth: 2, borderTopColor: 'rgb(168, 85, 247)' }}>
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-purple-400 mb-2">
                  <Search className="size-3" /> Close-Up
                  {photoCategories.closeUpPhotos.length > 0 && (
                    <span className="ml-auto text-[10px] bg-purple-500/20 px-1.5 py-0.5 rounded">{photoCategories.closeUpPhotos.length}</span>
                  )}
                </h4>
                {photoCategories.closeUpPhotos.length > 0 ? (
                  <PhotoGrid photos={photoCategories.closeUpPhotos} maxVisible={4} size="sm" />
                ) : (
                  <p className="text-[10px] text-muted-foreground">No photos</p>
                )}
              </div>
            </div>

            {/* ── Drawings — inline row ── */}
            {hasDrawings && (
              <div className="flex items-center gap-3 px-2 py-2 bg-muted/30 rounded-md">
                <Ruler className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-semibold text-muted-foreground shrink-0">Drawings</span>
                <div className="flex gap-3 overflow-x-auto">
                  {[
                    { d: matchedDrawings.main, label: matchedDrawings.main?.partNumber },
                    { d: matchedDrawings.tire, label: `Tire: ${matchedDrawings.tire?.partNumber}` },
                    { d: matchedDrawings.hub, label: `Hub: ${matchedDrawings.hub?.partNumber}` },
                  ].filter((x) => x.d?.drawing1Url).map((x, i) => (
                    <button
                      key={i}
                      onClick={() => setLightboxUrl(getDriveThumbUrl(x.d!.drawing1Url, 1200))}
                      className="shrink-0 group flex flex-col items-center"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getDriveThumbUrl(x.d!.drawing1Url, 300)}
                        alt={x.label || ''}
                        className="h-16 w-auto rounded border bg-muted object-contain group-hover:ring-2 ring-primary transition-all"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                      <span className="text-[10px] text-muted-foreground mt-0.5">{x.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Pallet Records — compact collapsible table ── */}
            {pallets.length > 0 && (
              <div className="rounded-md border bg-background/60 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30">
                  <span className="text-xs font-semibold">Pallet Records ({pallets.length})</span>
                  {pallets.length > 3 && (
                    <button
                      onClick={() => setShowAllPallets(!showAllPallets)}
                      className="text-[10px] text-primary flex items-center gap-0.5 hover:underline"
                    >
                      {showAllPallets ? 'Show less' : `Show all ${pallets.length}`}
                      {showAllPallets ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>
                  )}
                </div>
                <div className={`overflow-hidden transition-all duration-300 ${showAllPallets ? 'max-h-[500px] overflow-y-auto' : 'max-h-[120px]'}`}>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left px-3 py-1 font-medium">#</th>
                        <th className="text-left px-3 py-1 font-medium">Weight</th>
                        <th className="text-left px-3 py-1 font-medium">Dimensions</th>
                        <th className="text-left px-3 py-1 font-medium">Parts/Pallet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePallets.map((p, idx) => (
                        <tr key={idx} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-1 font-medium">{p.palletNumber || idx + 1}</td>
                          <td className="px-3 py-1">{p.weight || '-'} lbs</td>
                          <td className="px-3 py-1">{p.dimensions || '-'}</td>
                          <td className="px-3 py-1">{p.partsPerPallet || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
