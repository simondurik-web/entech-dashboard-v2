'use client'

import { useState, useMemo, useCallback } from 'react'
import type { Order } from '@/lib/google-sheets-shared'
import { authedFetch, authedJson } from '@/lib/authed-fetch'
import { buildLoadSheetHtml, openPrintShell, writePrintHtml, type LoadSheetOrder } from '@/lib/truckload-loadsheet'
import { useI18n } from '@/lib/i18n'
import enLocale from '@/locales/en.json'
import esLocale from '@/locales/es.json'

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
    partNo: 'P/N',
    due: 'Due',
    createTruckload: 'Create Truckload',
    truckloadHint: 'Lock these orders together — the shipping team must load all of them on the same truck.',
    truckloadOrders: 'Orders on this truck',
    truckloadNotes: 'Notes for the shipping team (optional)',
    truckloadExcluded: 'Not included (no ERP sales order):',
    truckloadNeedTwo: 'Link at least 2 orders (from different sales orders) to create a truckload.',
    truckloadCreate: 'Lock Truckload',
    truckloadCreating: 'Creating...',
    truckloadCreated: 'Truckload created:',
    truckloadCancel: 'Cancel',
    alreadyOnTl: 'Already on',
    oneCustomerNote: 'One truck = one customer. Showing only {customer} orders — unlink everything to pick a different customer.',
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
    partNo: 'N/P',
    due: 'Vence',
    createTruckload: 'Crear Carga de Camión',
    truckloadHint: 'Bloquea estas órdenes juntas — el equipo de embarques debe cargar todas en el mismo camión.',
    truckloadOrders: 'Órdenes en este camión',
    truckloadNotes: 'Notas para el equipo de embarques (opcional)',
    truckloadExcluded: 'No incluidas (sin orden de venta en el ERP):',
    truckloadNeedTwo: 'Vincula al menos 2 órdenes (de diferentes órdenes de venta) para crear una carga.',
    truckloadCreate: 'Bloquear Carga',
    truckloadCreating: 'Creando...',
    truckloadCreated: 'Carga creada:',
    truckloadCancel: 'Cancelar',
    alreadyOnTl: 'Ya está en',
    oneCustomerNote: 'Un camión = un cliente. Mostrando solo órdenes de {customer} — desvincula todo para elegir otro cliente.',
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
  weightEach: number
  numParts: number
  partName: string
  custPartName: string
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
function packPallets(types: PalletType[], trailer: { length: number; width: number }, typeInfo: Map<string, { numParts: number; partName: string; custPartName: string }>): PackResult {
  interface Spot {
    across: number
    along: number
    area: number
    typeOrder: number
    typeId: string
    colorIdx: number
    label: string
    weightEach: number
    numParts: number
    partName: string
    custPartName: string
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
      // auto: try both orientations and pick the one that wastes less space
      // Option A: width across trailer
      const aAcross = Math.floor(trailer.width / t.width)
      const aAlong = t.length
      const aWaste = trailer.width - (aAcross * t.width) // leftover width
      // Option B: length across trailer
      const bAcross = Math.floor(trailer.width / t.length)
      const bAlong = t.width
      const bWaste = trailer.width - (bAcross * t.length)
      // Prefer orientation that fits more across; tiebreak: less wasted width; then shorter along (more rows)
      if (aAcross > bAcross || (aAcross === bAcross && aWaste < bWaste) || (aAcross === bAcross && aWaste === bWaste && aAlong <= bAlong)) {
        across = t.width; along = t.length
      } else {
        across = t.length; along = t.width
      }
    }

    const count = t.doubleStack ? Math.ceil(t.qty / 2) : t.qty
    const info = typeInfo.get(t.id)
    for (let i = 0; i < count; i++) {
      spots.push({
        across, along,
        area: across * along,
        typeOrder: ti,
        typeId: t.id,
        colorIdx: t.colorIdx,
        label: t.label,
        weightEach: t.weightEach,
        numParts: info?.numParts ?? 0,
        partName: info?.partName ?? '',
        custPartName: info?.custPartName ?? '',
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
          weightEach: s.weightEach,
          numParts: s.numParts,
          partName: s.partName,
          custPartName: s.custPartName,
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
/** Active truckloads (from the host page) — lock the picker: a line already on
 *  a truckload can't be linked again (Simon 2026-07-10, TL-0004/SO-00067 gap). */
export interface ActiveTruckloadRef {
  load_number: string
  truckload_orders: { order_key: string; line: number | null; status: string }[]
}

export default function PalletLoadCalculator({
  stagedOrders = [],
  completedOrders = [],
  needToPackageOrders = [],
  lang = 'en',
  canCreateTruckload = false,
  onTruckloadCreated,
  activeTruckloads = [],
}: {
  stagedOrders?: Order[]
  completedOrders?: Order[]
  needToPackageOrders?: Order[]
  lang?: 'en' | 'es'
  /** manage_truckloads permission — shows the Create Truckload button */
  canCreateTruckload?: boolean
  onTruckloadCreated?: (loadNumber: string) => void
  activeTruckloads?: ActiveTruckloadRef[]
}) {
  const t = LABELS[lang]
  // hosts don't pass `lang` — the load sheet follows the app-wide language
  const { language } = useI18n()

  const [trailerKey, setTrailerKey] = useState<TrailerKey>(53)
  const [maxPayload, setMaxPayload] = useState(45000)
  const [palletTypes, setPalletTypes] = useState<PalletType[]>([defaultPalletType(0)])
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  // Create Truckload panel (Simon 2026-07-08: lock the linked orders together)
  const [tlOpen, setTlOpen] = useState(false)
  const [tlNotes, setTlNotes] = useState('')
  const [tlSaving, setTlSaving] = useState(false)
  const [tlError, setTlError] = useState<string | null>(null)
  const [tlCreated, setTlCreated] = useState<string | null>(null)
  const [tlCreatedId, setTlCreatedId] = useState<string | null>(null)

  const trailer = PLC_TRAILERS[trailerKey]

  // Build map of which orders are linked to which pallet
  const orderLinkMap = useMemo(() => {
    const map = new Map<string, number>()
    palletTypes.forEach((pt, i) => {
      pt.linkedOrderKeys.forEach((k) => map.set(k, i))
    })
    return map
  }, [palletTypes])

  // Build per-type parts info from linked orders
  const allOrders = useMemo(() => [...stagedOrders, ...completedOrders, ...needToPackageOrders], [stagedOrders, completedOrders, needToPackageOrders])
  const orderMap = useMemo(() => {
    const m = new Map<string, Order>()
    allOrders.forEach(o => m.set(getOrderKey(o), o))
    return m
  }, [allOrders])

  // Lines/keys already locked into an active truckload — line first (an
  // order_key repeats across multi-release lines), key as fallback.
  const tlLockedByLine = useMemo(() => {
    const byLine = new Map<string, string>()
    const byKey = new Map<string, string>()
    for (const tl of activeTruckloads) {
      for (const o of tl.truckload_orders) {
        if (o.status !== 'pending') continue
        if (o.line != null) byLine.set(String(o.line).trim(), tl.load_number)
        else if (o.order_key) byKey.set(o.order_key, tl.load_number)
      }
    }
    return { byLine, byKey }
  }, [activeTruckloads])
  const lockedTruckloadFor = useCallback(
    (o: Order): string | undefined =>
      tlLockedByLine.byLine.get(String(o.line ?? '').trim()) ?? tlLockedByLine.byKey.get(getOrderKey(o)),
    [tlLockedByLine]
  )

  // One truck ships ONE customer (Simon 2026-07-10): the first linked order
  // fixes the customer; the picker narrows to that customer until everything
  // is unlinked again.
  const linkedCustomer = useMemo(() => {
    for (const pt of palletTypes) {
      for (const k of pt.linkedOrderKeys) {
        const o = orderMap.get(k)
        if (o?.customer) return o.customer
      }
    }
    return null
  }, [palletTypes, orderMap])

  const typeInfo = useMemo(() => {
    const m = new Map<string, { numParts: number; partName: string; custPartName: string }>()
    palletTypes.forEach(pt => {
      const linkedOrders = pt.linkedOrderKeys.map(k => orderMap.get(k)).filter(Boolean) as Order[]
      const partNames = [...new Set(linkedOrders.map(o => o.partNumber).filter(Boolean))]
      const custPartNames = [...new Set(linkedOrders.map(o => o.customerPartNumber).filter(Boolean) as string[])]
      const totalParts = linkedOrders.reduce((sum, o) => sum + (o.orderQty || 0), 0)
      const partsPerPallet = pt.qty > 0 ? Math.round(totalParts / pt.qty) : totalParts
      m.set(pt.id, { numParts: partsPerPallet, partName: partNames.join(', '), custPartName: custPartNames.join(', ') })
    })
    return m
  }, [palletTypes, orderMap])

  const packResult = useMemo(() => packPallets(palletTypes, trailer, typeInfo), [palletTypes, trailer, typeInfo])

  // Truckload candidates: every linked order that maps to a real ERP sales
  // order. Orders without an SO (legacy IF-only rows) can't be locked — they
  // are listed as excluded so nothing silently disappears.
  const tlCandidates = useMemo(() => {
    const seen = new Set<string>()
    const included: { orderKey: string; soNumber: string; order: Order }[] = []
    const excluded: Order[] = []
    for (const pt of palletTypes) {
      for (const key of pt.linkedOrderKeys) {
        if (seen.has(key)) continue
        seen.add(key)
        const order = orderMap.get(key)
        if (!order) continue
        const soNumber = (order.ifNumber || '').split(' ')[0]
        if (/^(SO|SAL-ORD)-/.test(soNumber)) included.push({ orderKey: key, soNumber, order })
        else excluded.push(order)
      }
    }
    return { included, excluded }
  }, [palletTypes, orderMap])
  const tlDistinctSos = useMemo(() => new Set(tlCandidates.included.map((c) => c.soNumber)).size, [tlCandidates])

  const createTruckload = async () => {
    if (tlSaving || tlCandidates.included.length < 2) return
    setTlSaving(true)
    setTlError(null)
    try {
      // The rendered trailer diagram is snapshotted with the truckload so the
      // load sheet can print it later without re-mounting the calculator.
      const svgMarkup = document.getElementById('plc-export-area')?.querySelector('svg')?.outerHTML ?? null
      const res = await authedJson('/api/truckloads', 'POST', {
        notes: tlNotes.trim() || undefined,
        calculatorState: { trailerKey, maxPayload, palletTypes, svgMarkup },
        orders: tlCandidates.included.map((c) => {
          // real pallet-record count when the order has records; the package
          // estimate otherwise — printed on the load sheet (Simon 2026-07-09)
          const recs = (c.order as unknown as { pallets?: unknown[] }).pallets
          const palletCount =
            Array.isArray(recs) && recs.length > 0
              ? recs.length
              : c.order.numPackages > 0
                ? Math.ceil(c.order.numPackages)
                : undefined
          const lineNo = parseInt(String(c.order.line), 10)
          return {
            soNumber: c.soNumber,
            orderKey: c.orderKey,
            ifNumber: c.order.ifNumber,
            customer: c.order.customer,
            partNumber: c.order.partNumber,
            palletCount,
            line: Number.isInteger(lineNo) && lineNo > 0 ? lineNo : undefined,
          }
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Failed')
      const loadNumber = body.truckload.loadNumber as string
      setTlCreated(loadNumber)
      setTlCreatedId((body.truckload.id as string) ?? null)
      setTlOpen(false)
      setTlNotes('')
      onTruckloadCreated?.(loadNumber)
    } catch (err) {
      setTlError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setTlSaving(false)
    }
  }

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

      // Pre-fill dimensions from order pallet records (staged/completed have data)
      const hasData = (order.palletWidth && order.palletWidth > 0) || (order.palletLength && order.palletLength > 0)
      const fillW = hasData && order.palletWidth ? order.palletWidth : 48
      const fillL = hasData && order.palletLength ? order.palletLength : 40
      const fillWeight = order.palletWeightEach || 0

      // Build pallet configs from order's pallet records
      // Each pallet record has { dimensions: "48x40x42", weight: 1134, ... }
      // Group identical dims into configs: { width, length, weight, count }
      type PalletRecord = { dimensions?: string; weight?: number; width?: number; length?: number }
      const rawPallets: PalletRecord[] = ('pallets' in order && Array.isArray((order as any).pallets)) ? (order as any).pallets : []
      const palletConfigs = rawPallets.length > 0
        ? (() => {
            const groups = new Map<string, { width: number; length: number; weight: number; count: number }>()
            for (const p of rawPallets) {
              let w = 48, l = 40
              if (p.width && p.length) {
                w = p.width; l = p.length
              } else if (p.dimensions) {
                const parts = String(p.dimensions).split('x')
                if (parts.length >= 2) { w = Number(parts[0]) || 48; l = Number(parts[1]) || 40 }
              }
              const wt = p.weight || fillWeight || 0
              const key = `${w}x${l}x${wt}`
              const existing = groups.get(key)
              if (existing) { existing.count++ } else { groups.set(key, { width: w, length: l, weight: wt, count: 1 }) }
            }
            return Array.from(groups.values())
          })()
        : null

      // Pallet already has an order → create NEW pallet type(s) for this order
      if (pt.linkedOrderKeys.length > 0) {
        // If order has pallet configurations, create pallet types based on them
        if (palletConfigs && palletConfigs.length > 0) {
          const newPallets = palletConfigs.map((config, i) => {
            const ci = (prev.length + i) % PLC_COLORS.length
            return {
              id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`,
              label: order.customer ? `${order.customer.substring(0, 20)} (${config.width}"x${config.length}")` : `Pallet ${prev.length + i + 1}`,
              colorIdx: ci,
              width: config.width,
              length: config.length,
              qty: config.count,
              weightEach: config.weight,
              orientation: 'auto' as const,
              doubleStack: false,
              linkMode: true,
              linkedOrderKeys: [orderKey],
              linkSource: pt.linkSource,
            } as PalletType
          })
          return [...prev, ...newPallets]
        }

        // Single pallet configuration - create one pallet type
        const ci = prev.length % PLC_COLORS.length
        const palletCount = order.numPackages > 0 ? Math.ceil(order.numPackages) : 1
        const newPt: PalletType = {
          id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          label: order.customer ? order.customer.substring(0, 20) : `Pallet ${prev.length + 1}`,
          colorIdx: ci,
          width: fillW,
          length: fillL,
          qty: palletCount,
          weightEach: fillWeight,
          orientation: 'auto',
          doubleStack: false,
          linkMode: true,
          linkedOrderKeys: [orderKey],
          linkSource: pt.linkSource,
        }
        return [...prev, newPt]
      }

      // Selecting order on empty pallet
      // Fill THIS (clicked, empty) pallet with the order's first config in place,
      // then append any additional configs. Previously this left the empty pallet
      // untouched (qty 0) and appended every config, so the order landed on
      // pallet #2 while pallet #1 stayed empty — matching the reported bug. The
      // first config now reuses the clicked pallet's slot (id + color) so the
      // behavior mirrors the Ready-to-Ship calculator.
      if (palletConfigs && palletConfigs.length > 0) {
        const newPallets = palletConfigs.map((config, i) => {
          const reuseExisting = i === 0
          const ci = reuseExisting ? pt.colorIdx : (prev.length + i - 1) % PLC_COLORS.length
          return {
            id: reuseExisting ? pt.id : `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${i}`,
            label: order.customer
              ? `${order.customer.substring(0, 20)} (${config.width}"x${config.length}")`
              : (reuseExisting ? pt.label : `Pallet ${prev.length + i}`),
            colorIdx: ci,
            width: config.width,
            length: config.length,
            qty: config.count,
            weightEach: config.weight,
            orientation: 'auto' as const,
            doubleStack: false,
            linkMode: true,
            linkedOrderKeys: [orderKey],
            linkSource: pt.linkSource,
          } as PalletType
        })
        // First config replaces the empty pallet in place; extras are appended.
        return prev.map((p, i) => (i === idx ? newPallets[0] : p)).concat(newPallets.slice(1))
      }

      // Single pallet configuration - update the empty pallet
      const palletCount = order.numPackages > 0 ? Math.ceil(order.numPackages) : 1
      return prev.map((p, i) =>
        i === idx
          ? {
              ...p,
              linkedOrderKeys: [orderKey],
              label: order.customer ? order.customer.substring(0, 20) : p.label,
              qty: palletCount,
              width: fillW,
              length: fillL,
              weightEach: fillWeight,
            }
          : p
      )
    })
  }

  // ── SVG Diagram (horizontal: x=length, y=width) ──────
  const doorLabelSpace = 60 // extra space for "DOOR →" label on the right
  const svgWidth = 800 + doorLabelSpace
  const margin = 40
  const scale = (800 - margin * 2) / trailer.length
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
                    <p className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded">⚠️ For planning purposes — these orders are not ready to ship. You must enter estimated dimensions and weight manually.</p>
                  )}
                  {/* One truck = one customer: after the first link, the list narrows */}
                  {linkedCustomer && (
                    <p className="text-[10px] text-violet-600 bg-violet-500/10 border border-violet-500/40 px-2 py-1 rounded font-semibold">
                      🚛 {t.oneCustomerNote.replace('{customer}', linkedCustomer)}
                    </p>
                  )}
                  <input
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                    placeholder={t.search}
                    className="w-full px-2 py-1 rounded border bg-background text-xs"
                  />
                  <div data-lenis-prevent className="max-h-60 overflow-y-auto overscroll-contain space-y-0.5">
                    {(pt.linkSource === 'staged' ? stagedOrders : pt.linkSource === 'completed' ? completedOrders : needToPackageOrders)
                      .filter((o) => {
                        // customer lock: only the linked customer's orders stay
                        // visible (already-linked rows always show so they can
                        // be unticked)
                        if (
                          linkedCustomer &&
                          !pt.linkedOrderKeys.includes(getOrderKey(o)) &&
                          (o.customer || '').trim().toLowerCase() !== linkedCustomer.trim().toLowerCase()
                        ) {
                          return false
                        }
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
                        // already locked into an active truckload -> can't be
                        // planned onto another one (TL-0004/SO-00067 gap)
                        const lockedTl = !isLinkedHere ? lockedTruckloadFor(o) : undefined
                        return (
                          <label
                            key={key}
                            className={`flex items-start gap-2 text-xs py-0.5 ${
                              isLinkedElsewhere || lockedTl ? 'opacity-60' : 'cursor-pointer'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={isLinkedHere}
                              disabled={isLinkedElsewhere || !!lockedTl}
                              onChange={() => toggleOrderLink(pt.id, key, o)}
                            />
                            <span className="flex flex-col">
                              <span>
                                {o.ifNumber} — {o.customer} — {Array.isArray((o as any).pallets) && (o as any).pallets.length > 0 ? `${(o as any).pallets.length} pallets` : (o.numPackages > 0 ? `${Math.ceil(o.numPackages)} pallets` : `${o.orderQty} pcs`)}
                                {o.palletWidth && o.palletLength ? ` · ${o.palletWidth}×${o.palletLength}"` : ''}
                                {o.palletWeightEach ? ` · ${o.palletWeightEach} lbs` : ''}
                                {!o.palletWidth && !o.palletWeightEach && !Array.isArray((o as any).pallets) && pt.linkSource !== 'package' ? ' · no dims' : ''}
                              </span>
                              {(o.partNumber || o.requestedDate) && (
                                <span className="text-[10px] text-muted-foreground">
                                  {o.partNumber ? `${t.partNo} ${o.partNumber}` : ''}
                                  {o.partNumber && o.requestedDate ? ' · ' : ''}
                                  {o.requestedDate ? `${t.due} ${o.requestedDate}` : ''}
                                </span>
                              )}
                            </span>
                            {isLinkedElsewhere && (
                              <span className="text-muted-foreground">
                                ({t.linkedTo} #{(linkedToPallet ?? 0) + 1})
                              </span>
                            )}
                            {lockedTl && (
                              <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/15 text-violet-600">
                                🚛 {t.alreadyOnTl} {lockedTl}
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

      {/* Stats bar — right above diagram for screenshot */}
      <div id="plc-export-area" className="space-y-3 bg-background rounded-lg p-3 border">
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
                {/* Customer name */}
                {pw > 25 && ph > 14 && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 - 12}
                    textAnchor="middle"
                    fill="white"
                    fontSize={Math.min(8, pw / 8)}
                    fontWeight="600"
                  >
                    {p.label.length > pw / 5 ? p.label.slice(0, Math.floor(pw / 5)) : p.label}
                  </text>
                )}
                {/* Pallet dimensions W×L */}
                {pw > 25 && ph > 18 && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 - 2}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.8)"
                    fontSize={Math.min(7, pw / 9)}
                  >
                    {p.across}×{p.along}
                  </text>
                )}
                {/* Weight */}
                {pw > 25 && ph > 28 && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 + 8}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.7)"
                    fontSize={Math.min(6.5, pw / 9)}
                  >
                    {p.weightEach.toLocaleString()} lbs
                  </text>
                )}
                {/* Parts count */}
                {pw > 25 && ph > 36 && p.numParts > 0 && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 + 17}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.6)"
                    fontSize={Math.min(5.5, pw / 10)}
                  >
                    {p.numParts} pcs
                  </text>
                )}
                {/* Part name */}
                {pw > 25 && ph > 42 && p.partName && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 + 25}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.5)"
                    fontSize={Math.min(5, pw / 11)}
                  >
                    {p.partName.length > pw / 4.5 ? p.partName.slice(0, Math.floor(pw / 4.5)) : p.partName}
                  </text>
                )}
                {/* Customer part number (reference for the receiving dock) */}
                {pw > 25 && ph > 50 && p.custPartName && (
                  <text
                    x={px + pw / 2}
                    y={py + ph / 2 + 32}
                    textAnchor="middle"
                    fill="rgba(147,197,253,0.85)"
                    fontSize={Math.min(5, pw / 11)}
                  >
                    {p.custPartName.length > pw / 4.5 ? p.custPartName.slice(0, Math.floor(pw / 4.5)) : p.custPartName}
                  </text>
                )}
                {/* W×L dimension arrows on every pallet */}
                {pw > 30 && ph > 22 && (
                  <g opacity={0.7}>
                    {/* Width arrow (vertical / across) with arrowheads */}
                    <line x1={px + 3} y1={py + 2} x2={px + 3} y2={py + ph - 2} stroke="white" strokeWidth={0.6} />
                    <polygon points={`${px + 3},${py + 2} ${px + 1},${py + 6} ${px + 5},${py + 6}`} fill="white" />
                    <polygon points={`${px + 3},${py + ph - 2} ${px + 1},${py + ph - 6} ${px + 5},${py + ph - 6}`} fill="white" />
                    {/* Length arrow (horizontal / along) with arrowheads */}
                    <line x1={px + 2} y1={py + ph - 3} x2={px + pw - 2} y2={py + ph - 3} stroke="white" strokeWidth={0.6} />
                    <polygon points={`${px + 2},${py + ph - 3} ${px + 6},${py + ph - 5} ${px + 6},${py + ph - 1}`} fill="white" />
                    <polygon points={`${px + pw - 2},${py + ph - 3} ${px + pw - 6},${py + ph - 5} ${px + pw - 6},${py + ph - 1}`} fill="white" />
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

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {palletTypes.filter(pt => pt.qty > 0).map((pt) => {
          const c = PLC_COLORS[pt.colorIdx]
          const orientLabel = pt.orientation === 'widthwise' ? 'Width Across' : pt.orientation === 'lengthwise' ? 'Length Across' : 'Auto'
          return (
            <div key={pt.id} className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ background: c.fill, border: `1px solid ${c.stroke}` }} />
              <span>#{palletTypes.indexOf(pt) + 1} {pt.label} ({pt.width}&quot;×{pt.length}&quot;) — {pt.qty} pallets, {pt.weightEach} lbs/ea — {orientLabel}</span>
            </div>
          )
        })}
      </div>
      </div>{/* end plc-export-area */}

      {/* Export + Create Truckload */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => exportLoadPDF()}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          {tlCreatedId
            ? `🖨️ ${language === 'es' ? 'Hoja de Carga' : 'Load Sheet'} (${tlCreated})`
            : `📄 ${lang === 'es' ? 'Exportar PDF' : 'Export Load Report (PDF)'}`}
        </button>
        {canCreateTruckload && (
          <button
            onClick={() => {
              setTlCreated(null)
              setTlCreatedId(null)
              setTlError(null)
              setTlOpen((v) => !v)
            }}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            🚛 {t.createTruckload}
          </button>
        )}
      </div>

      {tlCreated && (
        <div className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-600 flex flex-wrap items-center gap-2">
          <span>
            ✓ {t.truckloadCreated} <span className="font-mono">{tlCreated}</span>
          </span>
          {tlCreatedId && (
            <button
              onClick={() => printCreatedLoadSheet()}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
            >
              🖨️ {language === 'es' ? 'Hoja de Carga' : 'Load Sheet'}
            </button>
          )}
        </div>
      )}

      {/* print/report errors — the create panel (and its error line) is closed
          by the time the success banner's print button can fail */}
      {tlError && !tlOpen && <p className="text-sm text-red-600 font-semibold">{tlError}</p>}

      {/* Create Truckload confirm panel */}
      {tlOpen && canCreateTruckload && (
        <div className="rounded-xl border border-violet-500/40 bg-violet-500/5 p-4 space-y-3">
          <p className="text-sm font-semibold">🚛 {t.createTruckload}</p>
          <p className="text-xs text-muted-foreground">{t.truckloadHint}</p>
          {tlCandidates.included.length < 2 || tlDistinctSos < 2 ? (
            <p className="text-sm text-amber-600 bg-amber-500/10 rounded px-3 py-2">{t.truckloadNeedTwo}</p>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  {t.truckloadOrders} ({tlCandidates.included.length})
                </p>
                <div className="rounded-lg border border-border divide-y divide-border bg-background/60">
                  {tlCandidates.included.map((c) => (
                    <div key={c.orderKey} className="px-3 py-1.5 text-xs flex flex-wrap gap-x-2">
                      <span className="font-mono font-semibold">{c.soNumber}</span>
                      <span className="truncate">{c.order.customer}</span>
                      <span className="text-muted-foreground">{c.order.partNumber}</span>
                    </div>
                  ))}
                </div>
              </div>
              {tlCandidates.excluded.length > 0 && (
                <p className="text-xs text-amber-600">
                  {t.truckloadExcluded}{' '}
                  {tlCandidates.excluded.map((o) => o.ifNumber || o.partNumber).join(', ')}
                </p>
              )}
              <textarea
                value={tlNotes}
                onChange={(e) => setTlNotes(e.target.value)}
                placeholder={t.truckloadNotes}
                rows={2}
                className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
              />
              {tlError && <p className="text-sm text-red-600 font-semibold">{tlError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => setTlOpen(false)}
                  disabled={tlSaving}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {t.truckloadCancel}
                </button>
                <button
                  onClick={createTruckload}
                  disabled={tlSaving}
                  className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 transition-colors disabled:opacity-60"
                >
                  {tlSaving ? t.truckloadCreating : `🔒 ${t.truckloadCreate}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  // Once a truckload exists, the calculator prints the SAME unified load sheet
  // as the Truckloads panel — TL number, pickup-reference notice, notes,
  // pallet IDs, customer part numbers, diagram (Simon 2026-07-16: the creation
  // report and the load sheet used to be two different documents).
  async function printCreatedLoadSheet() {
    if (!tlCreatedId) return
    const dict = (language === 'es' ? esLocale : enLocale) as Record<string, string>
    const enDict = enLocale as Record<string, string>
    const tr = (key: string) => dict[key] ?? enDict[key] ?? key
    const win = openPrintShell() // before the await — Safari popup blocking
    setTlError(null)
    try {
      if (!win) throw new Error(tr('truckload.popupBlocked'))
      const res = await authedFetch(`/api/truckloads/${tlCreatedId}?pallets=1`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'Failed')
      const tl = body.truckload as {
        load_number: string
        created_at: string
        created_by_name: string | null
        notes: string | null
        calculator_state?: { svgMarkup?: string | null } | null
        truckload_orders: LoadSheetOrder[]
      }
      writePrintHtml(
        win,
        buildLoadSheetHtml({
          loadNumber: tl.load_number,
          createdAt: tl.created_at,
          createdByName: tl.created_by_name,
          notes: tl.notes,
          svgMarkup: tl.calculator_state?.svgMarkup ?? null,
          orders: tl.truckload_orders ?? [],
          t: tr,
        })
      )
    } catch (err) {
      win?.close()
      setTlError(err instanceof Error ? err.message : 'Failed')
    }
  }

  function exportLoadPDF() {
    // the created truckload's load sheet IS the report from here on
    if (tlCreatedId) {
      void printCreatedLoadSheet()
      return
    }
    // Build HTML report for printing as PDF
    const trailerLabel = trailer.length === 636 ? '53\' Trailer' : '48\' Trailer'
    const rows = palletTypes.filter(pt => pt.qty > 0).map((pt) => {
      const orientLabel = pt.orientation === 'widthwise' ? 'Width Across' : pt.orientation === 'lengthwise' ? 'Length Across' : 'Auto'
      // Find linked orders
      const linkedOrders = [...new Set(pt.linkedOrderKeys.map(k => {
        const [ifNum] = k.split('||')
        return ifNum.trim()
      }).filter(Boolean))]
      return `<tr>
        <td>${pt.label}</td>
        <td>${linkedOrders.join(', ') || '—'}</td>
        <td style="text-align:center;">${pt.width}"</td>
        <td style="text-align:center;">${pt.length}"</td>
        <td style="text-align:center;">${pt.qty}</td>
        <td style="text-align:right;">${(pt.qty * pt.weightEach).toLocaleString()} lbs</td>
        <td style="text-align:center;">${orientLabel}</td>
      </tr>`
    }).join('')

    // Capture the SVG diagram
    const exportArea = document.getElementById('plc-export-area')
    const svgEl = exportArea?.querySelector('svg')
    const svgMarkup = svgEl ? svgEl.outerHTML : ''

    const html = `<!DOCTYPE html><html><head><title>Load Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 8px 12px; color: #1a1a2e; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
      .header-left h1 { font-size: 16px; margin: 0 0 2px; }
      .header-left .meta { color: #666; font-size: 10px; }
      .stats { display: flex; gap: 10px; }
      .stat { background: #f0f4f8; border-radius: 6px; padding: 4px 10px; text-align: center; }
      .stat-label { font-size: 8px; color: #666; }
      .stat-value { font-size: 13px; font-weight: 700; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 6px; }
      th { background: #1F3864; color: white; padding: 3px 6px; text-align: left; font-size: 9px; }
      td { font-size: 9px; padding: 2px 6px; border: 1px solid #ddd; }
      tr:nth-child(even) { background: #f2f6fc; }
      .diagram { margin: 4px 0; }
      .diagram svg { width: 100%; max-height: 260px; color: #333; }
      .diagram svg text { fill: #333; }
      .diagram svg rect[stroke] { stroke: #333; }
      .diagram svg line { stroke: #666; }
      .diagram svg marker path { fill: #666; }
      .status-ok { color: #16a34a; } .status-warn { color: #d97706; } .status-bad { color: #dc2626; }
      h2 { font-size: 11px; margin: 6px 0 3px; }
      .two-tables { display: flex; gap: 10px; }
      .two-tables > div { flex: 1; }
      @media print { body { margin: 5px 8px; } .no-print { display: none; } }
      @page { size: landscape; margin: 6mm; }
    </style></head><body>
    <div class="header">
      <div class="header-left">
        <h1>🚚 Pallet Load Report</h1>
        <div class="meta">${trailerLabel} · ${new Date().toLocaleDateString()} · Max Payload: ${maxPayload.toLocaleString()} lbs</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-label">Pallets</div><div class="stat-value">${totalPallets}</div></div>
        <div class="stat"><div class="stat-label">Weight</div><div class="stat-value">${totalWeight.toLocaleString()} lbs</div></div>
        <div class="stat"><div class="stat-label">Space</div><div class="stat-value">${spaceUsedPct}%</div></div>
        <div class="stat"><div class="stat-label">Status</div><div class="stat-value ${isOverweight ? 'status-bad' : hasOverflow ? 'status-warn' : 'status-ok'}">${loadStatus}</div></div>
      </div>
    </div>
    <table>
      <thead><tr>
        <th>Customer / Label</th><th>Sales Order Number(s)</th><th>Width</th><th>Length</th><th>Qty</th><th>Total Weight</th><th>Orientation</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="diagram">${svgMarkup}</div>
    <h2>📋 Pallet Details</h2>
    ${(() => {
      const placed = packResult.placed
      const mid = Math.ceil(placed.length / 2)
      const left = placed.slice(0, mid)
      const right = placed.slice(mid)
      const renderRows = (arr: typeof placed, startIdx: number) => arr.map((p, i) => `<tr>
        <td style="text-align:center;">${startIdx + i + 1}</td>
        <td>${p.label}</td>
        <td style="text-align:center;">${p.across}"×${p.along}"</td>
        <td style="text-align:right;">${p.weightEach.toLocaleString()} lbs</td>
        <td style="text-align:center;">${p.numParts > 0 ? p.numParts + ' pcs' : '—'}</td>
        <td>${p.partName || '—'}</td>
        <td>${p.custPartName || '—'}</td>
      </tr>`).join('')
      const tableHead = `<thead><tr><th>#</th><th>Customer</th><th>Dims</th><th>Weight</th><th>Parts</th><th>Part #</th><th>Cust Part #</th></tr></thead>`
      return `<div class="two-tables">
        <div><table>${tableHead}<tbody>${renderRows(left, 0)}</tbody></table></div>
        <div><table>${tableHead}<tbody>${renderRows(right, mid)}</tbody></table></div>
      </div>`
    })()}
    <div class="no-print" style="margin-top:20px;text-align:center;">
      <button onclick="window.print()" style="padding:10px 24px;background:#1F3864;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;">🖨️ Print / Save as PDF</button>
    </div>
    </body></html>`

    const win = window.open('', '_blank')
    if (win) {
      win.opener = null
      win.document.write(html)
      win.document.close()
    }
  }
}
