import { NextResponse } from 'next/server'
import { fetchOrders, fetchPalletRecords, fetchShippingRecords, normalizeStatus, type Order, type PalletRecord, type ShippingRecord } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ShippingOverviewOrder, ShippingOverviewPallet, ShippingOverviewResponse, ShippingOverviewShippingRecord } from '@/components/shipping-overview/types'

type OrderWithShippingFields = Order & {
  revenue?: number
  shipToAddress?: string
  shippingNotes?: string
  internalNotes?: string
  shippingCost?: number
}

type DashboardOrderRow = {
  line: string | null
  category: string | null
  if_number: string | null
  if_status_fusion: string | null
  work_order_status: string | null
  po_number: string | null
  customer: string | null
  part_number: string | null
  order_qty: number | null
  requested_completion_date: string | null
  days_until_promise: number | null
  shipped_date: string | null
  revenue: number | null
  ship_to_address: string | null
  shipping_notes: string | null
  internal_notes: string | null
  shipping_cost: number | null
  date_of_request: string | null
  priority_level: number | null
  urgent_override: boolean | null
  packaging: string | null
  parts_per_package: number | null
  number_of_packages: number | null
  fusion_inventory: number | null
  hub_mold: string | null
  tire: string | null
  have_tire: boolean | null
  hub: string | null
  have_hub: boolean | null
  bearings: string | null
  assigned_to: string | null
  daily_capacity: number | null
}

function str(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (value === null || value === undefined) return 0
  let clean = String(value).replace(/[$,\s]/g, '')
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = `-${clean.slice(1, -1)}`
  }
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : 0
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['true', '1', 'yes'].includes(str(value).toLowerCase())
}

function parseDate(value: string): Date | null {
  if (!value) return null
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) {
    const [, month, day, year] = slash
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeIfNumber(value: string): string {
  const trimmed = value.trim().toUpperCase().replace(/\s+/g, '')
  if (!trimmed) return ''
  const digits = trimmed.replace(/^IF/, '')
  return digits ? `IF${digits}` : ''
}

function normalizeLine(value: string): string {
  return value.trim()
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

async function fetchDashboardOrders(): Promise<OrderWithShippingFields[]> {
  try {
    const pageSize = 1000
    const rows: DashboardOrderRow[] = []
    let offset = 0

    while (true) {
      const { data, error } = await supabaseAdmin
        .from('dashboard_orders')
        .select('line, category, if_number, if_status_fusion, work_order_status, po_number, customer, part_number, order_qty, requested_completion_date, days_until_promise, shipped_date, revenue, ship_to_address, shipping_notes, internal_notes, shipping_cost, date_of_request, priority_level, urgent_override, packaging, parts_per_package, number_of_packages, fusion_inventory, hub_mold, tire, have_tire, hub, have_hub, bearings, assigned_to, daily_capacity')
        .range(offset, offset + pageSize - 1)

      if (error) throw error
      if (!data?.length) break
      rows.push(...data)
      if (data.length < pageSize) break
      offset += pageSize
    }

    return rows
      .map((row): OrderWithShippingFields => ({
        line: str(row.line),
        category: str(row.category),
        dateOfRequest: str(row.date_of_request),
        priorityLevel: num(row.priority_level),
        urgentOverride: bool(row.urgent_override),
        ifNumber: str(row.if_number),
        ifStatus: str(row.if_status_fusion),
        internalStatus: str(row.work_order_status),
        poNumber: str(row.po_number),
        customer: str(row.customer),
        partNumber: str(row.part_number),
        orderQty: num(row.order_qty),
        packaging: str(row.packaging),
        partsPerPackage: num(row.parts_per_package),
        numPackages: num(row.number_of_packages),
        fusionInventory: num(row.fusion_inventory),
        hubMold: str(row.hub_mold),
        tire: str(row.tire),
        hasTire: bool(row.have_tire),
        hub: str(row.hub),
        hasHub: bool(row.have_hub),
        bearings: str(row.bearings),
        requestedDate: str(row.requested_completion_date),
        daysUntilDue: row.days_until_promise ?? null,
        shippedDate: str(row.shipped_date),
        assignedTo: str(row.assigned_to),
        dailyCapacity: num(row.daily_capacity),
        priorityOverride: null,
        priorityChangedBy: null,
        priorityChangedAt: null,
        revenue: num(row.revenue),
        shipToAddress: str(row.ship_to_address),
        shippingNotes: str(row.shipping_notes),
        internalNotes: str(row.internal_notes),
        shippingCost: num(row.shipping_cost),
      }))
      .filter((order) => order.line && order.customer)
      .filter((order) => normalizeStatus(order.internalStatus, order.ifStatus) !== 'cancelled')
  } catch (error) {
    console.warn('shipping-overview: dashboard_orders unavailable, falling back to fetchOrders()', error)
    return (await fetchOrders()).map((order) => ({
      ...order,
      revenue: 0,
      shipToAddress: '',
      shippingNotes: '',
      internalNotes: '',
      shippingCost: 0,
    }))
  }
}

function isGhostPallet(record: PalletRecord): boolean {
  const palletNumber = str(record.palletNumber).trim()
  const weight = str(record.weight).trim().toUpperCase()
  const hasPhotos = (record.photos?.length ?? 0) > 0

  return (palletNumber === '' || palletNumber === '0')
    && (weight === '' || weight === '0' || weight === '0.0' || weight === 'N/A')
    && !hasPhotos
}

function toOverviewPallet(record: PalletRecord): ShippingOverviewPallet {
  const weightValue = num(record.weight)
  return {
    id: record.id,
    palletNumber: str(record.palletNumber),
    weight: weightValue,
    weightDisplay: str(record.weight),
    dimensions: str(record.dimensions),
    photos: uniqueStrings(record.photos ?? []),
    source: record._source ?? 'sheet',
  }
}

function mergeShippingRecords(records: ShippingRecord[]): ShippingOverviewShippingRecord | null {
  if (records.length === 0) return null

  const newestFirst = [...records].sort((a, b) => {
    const aTime = parseDate(a.shipDate || a.timestamp)?.getTime() ?? 0
    const bTime = parseDate(b.shipDate || b.timestamp)?.getTime() ?? 0
    return bTime - aTime
  })

  const primary = newestFirst[0]

  return {
    shipDate: primary.shipDate || primary.timestamp || '',
    carrier: primary.carrier || '',
    bol: primary.bol || '',
    shipmentPhotos: uniqueStrings(newestFirst.flatMap((record) => record.shipmentPhotos ?? [])),
    paperworkPhotos: uniqueStrings(newestFirst.flatMap((record) => record.paperworkPhotos ?? [])),
    closeUpPhotos: uniqueStrings(newestFirst.flatMap((record) => record.closeUpPhotos ?? [])),
  }
}

export async function GET(request: Request) {
  try {
    const [orders, sheetPallets, dbPalletResult, sheetShipping, dbShippingResult] = await Promise.all([
      fetchDashboardOrders(),
      fetchPalletRecords(),
      supabaseAdmin.from('pallet_records').select('*').order('created_at', { ascending: false }),
      fetchShippingRecords(),
      supabaseAdmin.from('shipping_records').select('*').order('created_at', { ascending: false }),
    ])

    const resolvedSheetPallets = await resolveRecordPhotos(sheetPallets, ['photos'])
    const resolvedSheetShipping = await resolveRecordPhotos(sheetShipping, [
      'photos',
      'shipmentPhotos',
      'paperworkPhotos',
      'closeUpPhotos',
    ])

    const dbPallets: PalletRecord[] = (dbPalletResult.data ?? []).map((record) => ({
      id: record.id,
      timestamp: record.created_at || '',
      orderNumber: record.line_number || '',
      lineNumber: record.line_number || '',
      palletNumber: String(record.pallet_number || ''),
      customer: '',
      ifNumber: record.order_id?.replace(/^IF/i, '') ? `IF${record.order_id.replace(/^IF/i, '')}` : '',
      category: '',
      weight: String(record.weight || ''),
      dimensions: record.length && record.width && record.height ? `${record.length}x${record.width}x${record.height}` : '',
      partsPerPallet: String(record.parts_per_pallet || ''),
      photos: record.photo_urls || [],
      shipmentPhotos: record.shipment_photo_urls || [],
      workPaperPhotos: record.work_paper_photo_urls || [],
      _source: 'app',
      length: record.length,
      width: record.width,
      height: record.height,
      order_id: record.order_id,
      edited_by_name: record.edited_by_name || undefined,
      edited_at: record.edited_at || undefined,
    }))

    const dbShipping: ShippingRecord[] = (dbShippingResult.data ?? []).map((record) => ({
      timestamp: record.created_at || '',
      shipDate: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US') : '',
      customer: record.customer || '',
      ifNumber: record.if_number || '',
      category: '',
      carrier: record.carrier || '',
      bol: '',
      palletCount: 0,
      photos: [],
      shipmentPhotos: record.shipment_photos || [],
      paperworkPhotos: record.paperwork_photos || [],
      closeUpPhotos: record.closeup_photos || [],
    }))

    const mergedPallets = [
      ...resolvedSheetPallets.map((record) => ({ ...record, _source: 'sheet' as const })),
      ...dbPallets,
    ]
      .filter((record) => !isGhostPallet(record))

    const palletGroups = new Map<string, PalletRecord[]>()
    for (const record of mergedPallets) {
      const line = normalizeLine(record.lineNumber || record.orderNumber || '')
      if (!line) continue
      const group = palletGroups.get(line) ?? []
      group.push(record)
      palletGroups.set(line, group)
    }

    const palletsByLine = new Map<string, ShippingOverviewPallet[]>()
    for (const [line, records] of palletGroups) {
      const hasAppRecords = records.some((record) => record._source === 'app')
      const keptRecords = hasAppRecords
        ? records.filter((record) => record._source === 'app')
        : records

      palletsByLine.set(line, keptRecords.map(toOverviewPallet))
    }

    const shippingByIf = new Map<string, ShippingOverviewShippingRecord>()
    const shippingGroups = new Map<string, ShippingRecord[]>()
    for (const record of [...resolvedSheetShipping, ...dbShipping]) {
      const ifNumber = normalizeIfNumber(record.ifNumber || '')
      if (!ifNumber) continue
      const group = shippingGroups.get(ifNumber) ?? []
      group.push(record)
      shippingGroups.set(ifNumber, group)
    }

    for (const [ifNumber, records] of shippingGroups) {
      const merged = mergeShippingRecords(records)
      if (merged) shippingByIf.set(ifNumber, merged)
    }

    const url = new URL(request.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 10, 1), 365)

    const now = new Date()
    const shippedCutoff = new Date(now)
    shippedCutoff.setDate(shippedCutoff.getDate() - days)

    const staged: ShippingOverviewOrder[] = []
    const shipped: ShippingOverviewOrder[] = []

    for (const order of orders) {
      const status = normalizeStatus(order.internalStatus, order.ifStatus)
      const line = normalizeLine(order.line)
      const ifNumber = normalizeIfNumber(order.ifNumber)
      const pallets = palletsByLine.get(line) ?? []
      const shipping = shippingByIf.get(ifNumber) ?? null

      const totalPalletWeight = pallets.reduce((sum, pallet) => sum + pallet.weight, 0)
      const dimensionsSummary = uniqueStrings(pallets.map((pallet) => pallet.dimensions)).join(', ')
      const palletPhotoCount = pallets.reduce((sum, pallet) => sum + pallet.photos.length, 0)
      const shippingPhotoCount = (shipping?.shipmentPhotos.length ?? 0)
        + (shipping?.paperworkPhotos.length ?? 0)
        + (shipping?.closeUpPhotos.length ?? 0)

      const overviewOrder: ShippingOverviewOrder = {
        line: order.line,
        ifNumber: order.ifNumber,
        poNumber: order.poNumber,
        customer: order.customer,
        category: order.category,
        partNumber: order.partNumber,
        status: status === 'shipped' ? 'shipped' : 'staged',
        orderQty: order.orderQty,
        revenue: num(order.revenue),
        requestedDate: order.requestedDate,
        shippedDate: order.shippedDate,
        daysUntilDue: order.daysUntilDue,
        shipToAddress: order.shipToAddress ?? '',
        shippingNotes: order.shippingNotes ?? '',
        internalNotes: order.internalNotes ?? '',
        shippingCost: num(order.shippingCost),
        pallets,
        palletCount: pallets.length,
        palletPhotoCount,
        totalPalletWeight,
        dimensionsSummary,
        shipping,
        shippingPhotoCount,
      }

      if (status === 'staged') {
        staged.push(overviewOrder)
        continue
      }

      if (status === 'shipped') {
        const shippedDate = parseDate(order.shippedDate)
        if (shippedDate && shippedDate >= shippedCutoff) {
          shipped.push(overviewOrder)
        }
      }
    }

    staged.sort((a, b) => (a.daysUntilDue ?? Number.MAX_SAFE_INTEGER) - (b.daysUntilDue ?? Number.MAX_SAFE_INTEGER))
    shipped.sort((a, b) => (parseDate(b.shippedDate)?.getTime() ?? 0) - (parseDate(a.shippedDate)?.getTime() ?? 0))

    const response: ShippingOverviewResponse = {
      staged,
      shipped,
      stats: {
        stagedOrders: staged.length,
        stagedRevenue: staged.reduce((sum, order) => sum + order.revenue, 0),
        stagedUnits: staged.reduce((sum, order) => sum + order.orderQty, 0),
        shippedOrders: shipped.length,
        shippedRevenue: shipped.reduce((sum, order) => sum + order.revenue, 0),
        shippedUnits: shipped.reduce((sum, order) => sum + order.orderQty, 0),
        totalRevenue: [...staged, ...shipped].reduce((sum, order) => sum + order.revenue, 0),
        totalUnits: [...staged, ...shipped].reduce((sum, order) => sum + order.orderQty, 0),
      },
      generatedAt: new Date().toISOString(),
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    })
  } catch (error) {
    console.error('Failed to build shipping overview:', error)
    return NextResponse.json({ error: 'Failed to build shipping overview' }, { status: 500 })
  }
}
