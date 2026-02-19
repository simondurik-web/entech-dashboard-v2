'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import type { Order } from '@/lib/google-sheets'

// ── Constants ──────────────────────────────────────────────
const PLC_TRAILERS = {
  53: { length: 636, width: 98.5 },
  48: { length: 576, width: 98.5 },
} as const

type TrailerKey = keyof typeof PLC_TRAILERS

const PLC_COLORS = [
  { fill: '#3b82f6', stroke: '#2563eb', label: 'Blue' },
  { fill: '#22c55e', stroke: '#16a34a', label: 'Green' },
  { fill: '#f59e0b', stroke: '#d97706', label: 'Amber' },
  { fill: '#ef4444', stroke: '#dc2626', label: 'Red' },
  { fill: '#8b5cf6', stroke: '#7c3aed', label: 'Violet' },
  { fill: '#06b6d4', stroke: '#0891b2', label: 'Cyan' },
  { fill: '#f97316', stroke: '#ea580c', label: 'Orange' },
  { fill: '#ec4899', stroke: '#db2777', label: 'Pink' },
]

const ORIENTATION = ['auto', 'widthwise', 'lengthwise'] as const
type Orientation = (typeof ORIENTATION)[number]

const LABELS = {
  en: {
    title: 'Pallet Load Calculator',
    trailer: 'Trailer',
    maxPayload: 'Max Payload (lbs)',
    addPallet: '+ Add Pallet Type',
    label: 'Label',
    width: 'W',
    length: 'L',
    qty: 'Qty',
    weight: 'Wt/ea',
    orientation: 'Orient.',
    auto: 'Auto',
    widthwise: 'Width Across',
    lengthwise: 'Length Across',
    doubleStack: '2×',
    remove: '✕',
    totalPallets: 'Total Pallets',
    totalWeight: 'Total Weight',
    spaceUsed: 'Space Used',
    loadStatus: 'Load Status',
    ok: 'OK',
    overweight: 'OVERWEIGHT',
    wontFit: "WON'T FIT",
    door: 'DOOR',
    linkOrders: 'Link Orders',
    search: 'Search orders...',
    linkedTo: 'Pallet',
  },
  es: {
    title: 'Calculadora de Carga de Tarimas',
    trailer: 'Tráiler',
    maxPayload: 'Carga Máxima (lbs)',
    addPallet: '+ Agregar Tipo de Tarima',
    label: 'Etiqueta',
    width: 'An',
    length: 'La',
    qty: 'Cant',
    weight: 'Peso/u',
    orientation: 'Orient.',
    auto: 'Auto',
    widthwise: 'Ancho Cruza',
    lengthwise: 'Largo Cruza',
    doubleStack: '2×',
    remove: '✕',
    totalPallets: 'Total Tarimas',
    totalWeight: 'Peso Total',
    spaceUsed: 'Espacio Usado',
    loadStatus: 'Estado de Carga',
    ok: 'OK',
    overweight: 'SOBREPESO',
    wontFit: 'NO CABE',
    door: 'PUERTA',
    linkOrders: 'Vincular Órdenes',
    search: 'Buscar órdenes...',
    linkedTo: 'Tarima',
  },
}

// ── Types ──────────────────────────────────────────────────
interface PalletType {
  id: string
  label: string
  colorIdx: number
  width: number
  length: number
  qty: number
  weightEach: number
  orientation: Orientation
  doubleStack: boolean
  linkMode: boolean
  linkedOrderKeys: string[]
  linkSource: 'staged' | 'completed' | 'package'
}

interface PlacedPallet {
  x: number
  y: number
  across: number
  along: number
  typeId: string
  colorIdx: number
  label: string
}

interface PackResult {
  placed: PlacedPallet[]
  overflow: number
}

// ── Helpers ────────────────────────────────────────────────
let _id = 0
const uid = () => `pt-${++_id}-${Date.now()}`

function getOrderKey(o: Order) {
  return `${o.ifNumber}||${o.partNumber}`
}

function defaultPalletType(index: number): PalletType {
  return {
    id: uid(),
    label: `Pallet ${index + 1}`,
    colorIdx: index % PLC_COLORS.length,
    width: 48,
    length: 40,
    qty: 1,
    weightEach: 1000,
    orientation: 'auto',
    doubleStack: false,
    linkMode: false,
    linkedOrderKeys: [],
    linkSource: 'staged',
  }
}

// ── Packing Algorithm ──────────────────────────────────────
function packPallets(types: PalletType[], trailer: { length: number; width: number }): PackResult {
  interface Spot {
    across: number
    along: number
    area: number
    typeOrder: number
    typeId: string
    colorIdx: number
    label: string
  }

  const spots: Spot[] = []

  for (let ti = 0; ti < types.length; ti++) {
    const t = types[ti]
    if (t.qty <= 0 || t.width <= 0 || t.length <= 0) continue

    let across: number, along: number
    if (t.orientation === 'widthwise') {
      across = t.width; along = t.length
    } else if (t.orientation === 'lengthwise') {
      across = t.length; along = t.width
    } else {
      // auto: pick orientation that fits more across
      const wAcross = Math.floor(trailer.width / t.width)
      const lAcross = Math.floor(trailer.width / t.length)
      if (wAcross >= lAcross) {
        across = t.width; along = t.length
      } else {
        across = t.length; along = t.width
      }
    }

    const count = t.doubleStack ? Math.ceil(t.qty / 2) : t.qty
    for (let i = 0; i < count; i++) {
      spots.push({
        across, along,
        area: across * along,
        typeOrder: ti,
        typeId: t.id,
        colorIdx: t.colorIdx,
        label: t.label,
      })
    }
  }

  // Sort by type order, then largest first
  spots.sort((a, b) => a.typeOrder - b.typeOrder || b.area - a.area)

  const placed: PlacedPallet[] = []
  const remaining = [...spots]
  let cursorY = 0

  while (remaining.length > 0 && cursorY < trailer.length) {
    let cursorX = 0
    let rowH = 0
    let placedAny = false

    for (let i = remaining.length - 1; i >= 0; i--) {
      // iterate forward for greedy
    }
    // re-do with forward iteration
    const toRemove: number[] = []
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]
      if (cursorX + s.across <= trailer.width && cursorY + s.along <= trailer.length) {
        placed.push({
          x: cursorX,
          y: cursorY,
          across: s.across,
          along: s.along,
          typeId: s.typeId,
          colorIdx: s.colorIdx,
          label: s.label,
        })
        cursorX += s.across
        rowH = Math.max(rowH, s.along)
        toRemove.push(i)
        placedAny = true
      }
    }

    // Remove placed from remaining (reverse order to keep indices valid)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      remaining.splice(toRemove[i], 1)
    }

    if (!placedAny) break
    cursorY += rowH
  }

  return { placed, overflow: remaining.length }
}

// ── Component ──────────────────────────────────────────────
export default function PalletLoadCalculator({
  stagedOrders = [],
  completedOrders = [],
  needToPackageOrders = [],
  lang = 'en',
}: {
  stagedOrders?: Order[]
  completedOrders?: Order[]
  needToPackageOrders?: Order[]
  lang?: 'en' | 'es'
}) {
  const t = LABELS[lang]

  const [trailerKey, setTrailerKey] = useState<TrailerKey>(53)
  const [maxPayload, setMaxPayload] = useState(45000)
  const [palletTypes, setPalletTypes] = useState<PalletType[]>([defaultPalletType(0)])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [linkSearch, setLinkSearch] = useState('')

  const trailer = PLC_TRAILERS[trailerKey]

  // Build map of which orders are linked to which pallet
  const orderLinkMap = useMemo(() => {
    const map = new Map<string, number>()
    palletTypes.forEach((pt, i) => {
      pt.linkedOrderKeys.forEach((k) => map.set(k, i))
    })
    return map
  }, [palletTypes])

  const packResult = useMemo(() => packPallets(palletTypes, trailer), [palletTypes, trailer])

  const totalPallets = palletTypes.reduce((s, p) => s + p.qty, 0)
  const totalWeight = palletTypes.reduce((s, p) => s + p.qty * p.weightEach, 0)

  // Space used: sum of placed pallet areas / trailer area
  const trailerArea = trailer.length * trailer.width
  const placedArea = packResult.placed.reduce((s, p) => s + p.across * p.along, 0)
  const spaceUsedPct = trailerArea > 0 ? Math.round((placedArea / trailerArea) * 100) : 0

  const isOverweight = totalWeight > maxPayload
  const hasOverflow = packResult.overflow > 0
  const loadStatus = isOverweight ? t.overweight : hasOverflow ? t.wontFit : t.ok
  const loadColor = isOverweight ? 'text-red-500' : hasOverflow ? 'text-amber-500' : 'text-green-500'

  const weightPct = maxPayload > 0 ? Math.min(100, Math.round((totalWeight / maxPayload) * 100)) : 0
  const weightBarColor = weightPct > 100 ? 'bg-red-500' : weightPct > 85 ? 'bg-amber-500' : 'bg-green-500'

  // ── Handlers ───────────────────────────────────────────
  const updateType = useCallback((id: string, patch: Partial<PalletType>) => {
    setPalletTypes((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])

  const addType = () => {
    setPalletTypes((prev) => [...prev, defaultPalletType(prev.length)])
  }

  const removeType = (id: string) => {
    setPalletTypes((prev) => prev.filter((p) => p.id !== id))
  }

  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    setPalletTypes((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setDragIdx(idx)
  }
  const handleDragEnd = () => setDragIdx(null)

  const toggleOrderLink = (palletId: string, orderKey: string, order: Order) => {
    setPalletTypes((prev) => {
      const idx = prev.findIndex((p) => p.id === palletId)
      if (idx < 0) return prev
      const pt = prev[idx]
      const has = pt.linkedOrderKeys.includes(orderKey)

      // Deselecting — remove order from pallet
      if (has) {
        const newKeys = pt.linkedOrderKeys.filter((k) => k !== orderKey)
        const updated = { ...pt, linkedOrderKeys: newKeys }
        if (newKeys.length === 0) {
          updated.qty = 0
          updated.weightEach = 0
          updated.label = `Pallet ${idx + 1}`
        }
        return prev.map((p, i) => (i === idx ? updated : p))
      }

      // Pallet already has an order → create NEW pallet type for this order
      if (pt.linkedOrderKeys.length > 0) {
        const ci = prev.length % PLC_COLORS.length
        const palletCount = order.numPackages > 0 ? Math.ceil(order.numPackages) : 1
        const newPt: PalletType = {
          id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: order.customer ? order.customer.substring(0, 20) : `Pallet ${prev.length + 1}`,
          colorIdx: ci,
          width: 48,
          length: 40,
          qty: palletCount,
          weightEach: 0,
          orientation: 'auto',
          doubleStack: false,
          linkMode: true,
          linkedOrderKeys: [orderKey],
          linkSource: pt.linkSource,
        }
        return [...prev, newPt]
      }

      // Selecting order on empty pallet
      const palletCount = order.numPackages > 0 ? Math.ceil(order.numPackages) : 1
      return prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              linkedOrderKeys: [orderKey],
              label: order.customer ? order.customer.substring(0, 20) : p.label,
              qty: palletCount,
            }
          : p
      )
    })
  }

  // ── SVG Diagram (horizontal: x=length, y=width) ──────
  const svgWidth = 800
  const margin = 40
  const scale = (svgWidth - margin * 2) / trailer.length
  const svgTrailerW = trailer.length * scale
  const svgTrailerH = trailer.width * scale
  const svgH = svgTrailerH + margin * 2 + (packResult.overflow > 0 ? 60 : 0)

  return (
    <div className="bg-card border rounded-xl p-4 space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-4">
        <h3 className="font-semibold text-lg">{t.title}</h3>
        <div className="flex gap-1">
          {([53, 48] as TrailerKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setTrailerKey(k)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                trailerKey === k
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {k}&apos;
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">{t.maxPayload}</label>
          <input
            type="number"
            value={maxPayload}
            onChange={(e) => setMaxPayload(Number(e.target.value) || 0)}
            className="w-24 px-2 py-1 rounded border bg-background text-sm"
          />
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div className="bg-muted/50 rounded p-2">
          <div className="text-muted-foreground text-xs">{t.totalPallets}</div>
          <div className="font-bold text-lg">{totalPallets}</div>
        </div>
        <div className="bg-muted/50 rounded p-2">
          <div className="text-muted-foreground text-xs">{t.totalWeight}</div>
          <div className="font-bold text-lg">{totalWeight.toLocaleString()} lbs</div>
          <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all ${weightBarColor}`} style={{ width: `${weightPct}%` }} />
          </div>
        </div>
        <div className="bg-muted/50 rounded p-2">
          <div className="text-muted-foreground text-xs">{t.spaceUsed}</div>
          <div className="font-bold text-lg">{spaceUsedPct}%</div>
        </div>
        <div className="bg-muted/50 rounded p-2">
          <div className="text-muted-foreground text-xs">{t.loadStatus}</div>
          <div className={`font-bold text-lg ${loadColor}`}>{loadStatus}</div>
        </div>
      </div>

      {/* Pallet types */}
      <div className="space-y-2">
        {palletTypes.map((pt, idx) => {
          const color = PLC_COLORS[pt.colorIdx]
          return (
            <div
              key={pt.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`border rounded-lg p-3 space-y-2 transition-opacity ${
                dragIdx === idx ? 'opacity-50' : ''
              }`}
              style={{ borderLeftColor: color.fill, borderLeftWidth: 4 }}
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* Drag handle */}
                <span className="cursor-grab text-muted-foreground select-none">⠿</span>

                {/* Color picker */}
                <button
                  onClick={() => updateType(pt.id, { colorIdx: (pt.colorIdx + 1) % PLC_COLORS.length })}
                  className="w-6 h-6 rounded-full border-2 shrink-0"
                  style={{ backgroundColor: color.fill, borderColor: color.stroke }}
                  title={color.label}
                />

                {/* Label */}
                <input
                  value={pt.label}
                  onChange={(e) => updateType(pt.id, { label: e.target.value })}
                  placeholder={t.label}
                  className="px-2 py-1 rounded border bg-background text-sm w-32"
                />

                {/* Dims */}
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground">{t.width}</span>
                  <input
                    type="number"
                    value={pt.width}
                    onChange={(e) => updateType(pt.id, { width: Number(e.target.value) || 0 })}
                    className="w-14 px-1 py-1 rounded border bg-background text-sm"
                  />
                  <span className="text-muted-foreground">×</span>
                  <span className="text-muted-foreground">{t.length}</span>
                  <input
                    type="number"
                    value={pt.length}
                    onChange={(e) => updateType(pt.id, { length: Number(e.target.value) || 0 })}
                    className="w-14 px-1 py-1 rounded border bg-background text-sm"
                  />
                </div>

                {/* Qty & weight */}
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-muted-foreground">{t.qty}</span>
                  <input
                    type="number"
                    value={pt.qty}
                    onChange={(e) => updateType(pt.id, { qty: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-12 px-1 py-1 rounded border bg-background text-sm"
                  />
                  <span className="text-muted-foreground">{t.weight}</span>
                  <input
                    type="number"
                    value={pt.weightEach}
                    onChange={(e) => updateType(pt.id, { weightEach: Number(e.target.value) || 0 })}
                    className="w-16 px-1 py-1 rounded border bg-background text-sm"
                  />
                </div>

                {/* Orientation */}
                <select
                  value={pt.orientation}
                  onChange={(e) => updateType(pt.id, { orientation: e.target.value as Orientation })}
                  className="px-1 py-1 rounded border bg-background text-xs"
                >
                  <option value="auto">{t.auto}</option>
                  <option value="widthwise">{t.widthwise}</option>
                  <option value="lengthwise">{t.lengthwise}</option>
                </select>

                {/* Double stack */}
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pt.doubleStack}
                    onChange={(e) => updateType(pt.id, { doubleStack: e.target.checked })}
                  />
                  {t.doubleStack}
                </label>

                {/* Link orders toggle */}
                {(stagedOrders.length > 0 || completedOrders.length > 0 || needToPackageOrders.length > 0) && (
                  <button
                    onClick={() => updateType(pt.id, { linkMode: !pt.linkMode })}
                    className={`text-xs px-2 py-1 rounded ${
                      pt.linkMode ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    🔗 {t.linkOrders}
                  </button>
                )}

                {/* Remove */}
                <button
                  onClick={() => removeType(pt.id)}
                  className="ml-auto text-muted-foreground hover:text-destructive text-sm"
                >
                  {t.remove}
                </button>
              </div>

              {/* Link orders panel — 3 sources (per-pallet) */}
              {pt.linkMode && (
                <div className="border rounded p-2 bg-muted/30 space-y-2">
                  {/* Source tabs */}
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={() => updateType(pt.id, { linkSource: 'staged' })} className={`text-[10px] px-2 py-1 rounded font-medium ${pt.linkSource === 'staged' ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                      🚚 Link Ready to Ship ({stagedOrders.length})
                    </button>
                    <button onClick={() => updateType(pt.id, { linkSource: 'completed' })} className={`text-[10px] px-2 py-1 rounded font-medium ${pt.linkSource === 'completed' ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                      ✅ Link Completed ({completedOrders.length})
                    </button>
                    <button onClick={() => updateType(pt.id, { linkSource: 'package' })} className={`text-[10px] px-2 py-1 rounded font-medium ${pt.linkSource === 'package' ? 'bg-amber-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                      📦 Link Need to Package ({needToPackageOrders.length})
                    </button>
                  </div>
                  {/* Disclaimer for non-staged */}
                  {pt.linkSource === 'completed' && (
                    <p className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded">⚠️ This order is not staged yet — this is used for planning purposes.</p>
                  )}
                  {pt.linkSource === 'package' && (
                    <p className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded">⚠️ For planning purposes — these orders are not ready to ship.</p>
                  )}
                  <input
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                    placeholder={t.search}
                    className="w-full px-2 py-1 rounded border bg-background text-xs"
                  />
                  <div className="max-h-40 overflow-y-auto space-y-0.5">
                    {(pt.linkSource === 'staged' ? stagedOrders : pt.linkSource === 'completed' ? completedOrders : needToPackageOrders)
                      .filter((o) => {
                        if (!linkSearch.trim()) return true
                        const q = linkSearch.toLowerCase()
                        return (
                          o.customer.toLowerCase().includes(q) ||
                          o.ifNumber.toLowerCase().includes(q) ||
                          o.partNumber.toLowerCase().includes(q)
                        )
                      })
                      .map((o) => {
                        const key = getOrderKey(o)
                        const linkedToPallet = orderLinkMap.get(key)
                        const isLinkedHere = pt.linkedOrderKeys.includes(key)
                        const isLinkedElsewhere = linkedToPallet !== undefined && !isLinkedHere
                        return (
                          <label
                            key={key}
                            className={`flex items-center gap-2 text-xs py-0.5 ${
                              isLinkedElsewhere ? 'opacity-50' : 'cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isLinkedHere}
                              disabled={isLinkedElsewhere}
                              onChange={() => toggleOrderLink(pt.id, key, o)}
                            />
                            <span>
                              {o.ifNumber} — {o.customer} — {o.partNumber} — {o.numPackages > 0 ? `${Math.ceil(o.numPackages)} pallets` : `${o.orderQty} pcs`}
                            </span>
                            {isLinkedElsewhere && (
                              <span className="text-muted-foreground">
                                ({t.linkedTo} #{(linkedToPallet ?? 0) + 1})
                              </span>
                            )}
                          </label>
                        )
                      })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <button
          onClick={addType}
          className="w-full py-2 rounded-lg border border-dashed text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          {t.addPallet}
        </button>
      </div>

      {/* SVG Trailer Diagram — HORIZONTAL (left=front, right=door) */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgH}`}
          className="w-full mx-auto"
          style={{ minHeight: 200 }}
        >
          {/* Arrow markers */}
          <defs>
            {['arrowR', 'arrowL', 'arrowD', 'arrowU'].map((id) => (
              <marker key={id} id={id} markerWidth={6} markerHeight={6} refX={3} refY={3} orient="auto">
                <path d={id.includes('R') || id.includes('D') ? 'M0,0 L6,3 L0,6' : 'M6,0 L0,3 L6,6'} fill="currentColor" className="text-muted-foreground" />
              </marker>
            ))}
          </defs>

          {/* Trailer outline */}
          <rect
            x={margin}
            y={margin}
            width={svgTrailerW}
            height={svgTrailerH}
            rx={6}
            ry={6}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-border"
          />

          {/* Dimension arrows - length (top) */}
          <line x1={margin} y1={margin - 12} x2={margin + svgTrailerW} y2={margin - 12} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" markerStart="url(#arrowL)" markerEnd="url(#arrowR)" />
          <text x={margin + svgTrailerW / 2} y={margin - 18} textAnchor="middle" className="text-muted-foreground fill-current" fontSize={10}>
            {trailer.length}&quot;
          </text>

          {/* Dimension arrows - width (left) */}
          <line x1={margin - 12} y1={margin} x2={margin - 12} y2={margin + svgTrailerH} stroke="currentColor" strokeWidth={1} className="text-muted-foreground" markerStart="url(#arrowU)" markerEnd="url(#arrowD)" />
          <text x={margin - 18} y={margin + svgTrailerH / 2} textAnchor="middle" className="text-muted-foreground fill-current" fontSize={10} transform={`rotate(-90, ${margin - 18}, ${margin + svgTrailerH / 2})`}>
            {trailer.width}&quot;
          </text>

          {/* FRONT label (left) */}
          <text
            x={margin - 4}
            y={margin + svgTrailerH / 2}
            textAnchor="end"
            className="fill-current text-muted-foreground"
            fontSize={9}
            transform={`rotate(-90, ${margin - 4}, ${margin + svgTrailerH / 2})`}
          >
            ◄ FRONT
          </text>

          {/* DOOR label (right) */}
          <text
            x={margin + svgTrailerW + 16}
            y={margin + svgTrailerH / 2 + 4}
            textAnchor="start"
            className="fill-current text-muted-foreground"
            fontSize={12}
            fontWeight="bold"
          >
            {t.door} →
          </text>

          {/* Placed pallets — horizontal: x maps to trailer length (along), y maps to width (across)
              Packing algo: p.x = across position (width), p.y = along position (length from door)
              In horizontal SVG: svgX = door is right, so x = margin + svgTrailerW - (p.y + p.along) * scale
                                  svgY = margin + p.x * scale */}
          {packResult.placed.map((p, i) => {
            const c = PLC_COLORS[p.colorIdx] || PLC_COLORS[0]
            // Horizontal: along direction = left-right (length), across = top-bottom (width)
            const px = margin + svgTrailerW - (p.y + p.along) * scale
            const py = margin + p.x * scale
            const pw = p.along * scale  // along maps to x-width in SVG
            const ph = p.across * scale // across maps to y-height in SVG
            return (
              <g key={i}>
                <rect
                  x={px}
                  y={py}
                  width={pw}
                  height={ph}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={1}
                  rx={2}
                  opacity={0.85}
                />
                {/* Pallet label */}
                {pw > 25 && ph > 14 && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 - 2}
                    textAnchor="middle"
                    fill="white"
                    fontSize={Math.min(9, pw / 6)}
                    fontWeight="600"
                  >
                    {p.label.slice(0, 8)}
                  </text>
                )}
                {/* Pallet dimensions W×L text */}
                {pw > 25 && ph > 18 && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 + 10}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.8)"
                    fontSize={Math.min(8, pw / 7)}
                  >
                    {p.across}×{p.along}
                  </text>
                )}
                {/* Dimension arrows on first pallet of each type */}
                {i === packResult.placed.findIndex(pp => pp.typeId === p.typeId) && pw > 35 && ph > 25 && (
                  <g>
                    {/* Width arrow (vertical / across) */}
                    <line x1={px - 4} y1={py + 2} x2={px - 4} y2={py + ph - 2} stroke="white" strokeWidth={0.8} strokeDasharray="2,1" opacity={0.7} markerStart="url(#arrowU)" markerEnd="url(#arrowD)" />
                    <text x={px - 7} y={py + ph / 2} textAnchor="middle" fill="white" fontSize={7} opacity={0.8} transform={`rotate(-90, ${px - 7}, ${py + ph / 2})`}>
                      W:{p.across}&quot;
                    </text>
                    {/* Length arrow (horizontal / along) */}
                    <line x1={px + 2} y1={py + ph + 4} x2={px + pw - 2} y2={py + ph + 4} stroke="white" strokeWidth={0.8} strokeDasharray="2,1" opacity={0.7} markerStart="url(#arrowL)" markerEnd="url(#arrowR)" />
                    <text x={px + pw / 2} y={py + ph + 11} textAnchor="middle" fill="white" fontSize={7} opacity={0.8}>
                      L:{p.along}&quot;
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* Overflow indicator */}
          {packResult.overflow > 0 && (
            <g>
              <rect
                x={margin}
                y={margin + svgTrailerH + 16}
                width={svgTrailerW}
                height={28}
                fill="#fee2e2"
                stroke="#ef4444"
                strokeWidth={1}
                rx={4}
              />
              <text
                x={margin + svgTrailerW / 2}
                y={margin + svgTrailerH + 34}
                textAnchor="middle"
                fill="#dc2626"
                fontSize={11}
                fontWeight="600"
              >
                +{packResult.overflow} pallets won&apos;t fit
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
