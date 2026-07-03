import { erpnextGet, erpnextGetDoc } from './client'

// Read-only Sales Order fulfillment view for the dashboard "Ship Order" screen
// (fulfillment wrapper, Phase 1). Server-side only.
//
// HARD RULE: NO pricing fields in anything this module returns. The shipping
// floor never sees dollar amounts — line rates are enforced server-side in
// ERPNext when the Delivery Note validates (Simon 2026-07-02).

const ACTIVE_SRE_STATUS = ['Reserved', 'Partially Reserved', 'Partially Delivered']
const SRE_FETCH_CONCURRENCY = 6

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

/** Bounded-concurrency map (same pattern as staging.ts) so an order with many
 *  pallets can't fire dozens of simultaneous ERPNext calls. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

interface SOItemRow {
  name: string
  item_code: string
  qty: number
  stock_qty?: number | null
  delivered_qty?: number | null
  stock_reserved_qty?: number | null
}

interface SODoc {
  name: string
  customer: string
  po_no?: string | null
  delivery_date?: string | null
  status: string
  docstatus: number
  custom_staging_status?: string | null
  custom_staged_at?: string | null
  items: SOItemRow[]
}

export interface FulfillmentLine {
  soItem: string // Sales Order Item child name (the reservation/DN link key)
  itemCode: string
  itemName: string
  hasImage: boolean // true -> the client may load /api/erpnext/fulfillment/item-image?item=<code>
  orderedQty: number
  deliveredQty: number
  reservedQty: number
}

export interface StagedPallet {
  palletId: string // Batch name — what the floor scans/reads on the label
  itemCode: string
  qty: number // reserved qty from this pallet
  warehouse: string
  status: string // SRE status (Reserved / Partially Reserved / Partially Delivered)
}

export interface FulfillmentOrder {
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

/** Everything the Ship Order screen needs for one Sales Order, in two-plus-N
 *  bounded ERPNext reads: the SO doc, the item display info, and the active
 *  stock reservations (each read fully to reach its batch entries — the child
 *  table isn't listable directly for dashboard-svc). */
export async function getFulfillmentOrder(soName: string): Promise<FulfillmentOrder> {
  const doc = await erpnextGetDoc<SODoc>('Sales Order', soName)

  // Item display info (name + whether a picture exists) for the distinct codes.
  const codes = [...new Set((doc.items ?? []).map((l) => l.item_code))]
  const itemInfo: Record<string, { itemName: string; hasImage: boolean }> = {}
  if (codes.length) {
    const qs = [
      listParam('filters', [['item_code', 'in', codes]]),
      listParam('fields', ['item_code', 'item_name', 'image']),
      'limit_page_length=0',
    ].join('&')
    const rows =
      (await erpnextGet<{ data: { item_code: string; item_name: string; image?: string | null }[] }>(
        `/api/resource/Item?${qs}`
      )).data ?? []
    for (const r of rows) itemInfo[r.item_code] = { itemName: r.item_name, hasImage: !!r.image }
  }

  const lines: FulfillmentLine[] = (doc.items ?? []).map((l) => ({
    soItem: l.name,
    itemCode: l.item_code,
    itemName: itemInfo[l.item_code]?.itemName ?? l.item_code,
    hasImage: itemInfo[l.item_code]?.hasImage ?? false,
    orderedQty: Number(l.stock_qty ?? l.qty) || 0,
    deliveredQty: Number(l.delivered_qty) || 0,
    reservedQty: Number(l.stock_reserved_qty) || 0,
  }))

  // Active reservations on this SO -> the staged pallets (batch, qty, bin).
  const qs = [
    listParam('filters', [
      ['voucher_type', '=', 'Sales Order'],
      ['voucher_no', '=', soName],
      ['status', 'in', ACTIVE_SRE_STATUS],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', ['name', 'item_code', 'warehouse', 'status', 'reserved_qty']),
    'limit_page_length=0',
  ].join('&')
  const sres =
    (await erpnextGet<{
      data: { name: string; item_code: string; warehouse: string; status: string; reserved_qty: number }[]
    }>(`/api/resource/Stock Reservation Entry?${qs}`)).data ?? []

  const palletLists = await mapLimit(sres, SRE_FETCH_CONCURRENCY, async (s) => {
    try {
      const full = await erpnextGetDoc<{ sb_entries?: { batch_no?: string | null; qty: number }[] }>(
        'Stock Reservation Entry',
        s.name
      )
      return (full.sb_entries ?? [])
        .filter((e) => e.batch_no)
        .map((e) => ({
          palletId: String(e.batch_no),
          itemCode: s.item_code,
          qty: Math.abs(Number(e.qty) || 0) || Number(s.reserved_qty) || 0,
          warehouse: s.warehouse,
          status: s.status,
        }))
    } catch {
      return [] // one unreadable SRE shouldn't blank the whole screen
    }
  })
  // One pallet can appear in only one active reservation for this SO; dedupe defensively.
  const pallets = Array.from(
    new Map(palletLists.flat().map((p) => [p.palletId, p])).values()
  ).sort((a, b) => a.palletId.localeCompare(b.palletId))

  return {
    so: doc.name,
    customer: doc.customer,
    poNo: doc.po_no ?? null,
    deliveryDate: doc.delivery_date ?? null,
    status: doc.status,
    stagingStatus: doc.custom_staging_status ?? null,
    stagedAt: doc.custom_staged_at ?? null,
    lines,
    pallets,
  }
}

/** The Item's picture path (e.g. "/files/Tire 163-….jpg") or null. Used by the
 *  image proxy route — erp.4molding.com/files sits behind Cloudflare Access, so
 *  the browser can't load it directly. */
export async function getItemImagePath(itemCode: string): Promise<string | null> {
  const item = await erpnextGetDoc<{ image?: string | null }>('Item', itemCode).catch(() => null)
  const img = item?.image ?? null
  // Only ever proxy public /files assets — never private files or arbitrary paths.
  return img && img.startsWith('/files/') ? img : null
}
