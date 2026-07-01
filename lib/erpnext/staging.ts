import {
  erpnextGet,
  erpnextGetDoc,
  erpnextCreate,
  erpnextUpdate,
  erpnextRunDocMethod,
} from './client'
import type { Committed } from './operation'

// "Prepare for staging" — reserve specific pallets (batches) to an open Sales Order in
// ERPNext so the physical stock is locked to that order before it ships. Company is fixed
// to Molding. All writes are server-side only.
//
// The reservation mechanism (validated on the live ERPNext server):
//   1. The SO Item must have reserve_stock=1 (backfilled on all open SO items).
//   2. Create a Serial and Batch Bundle (Outward / Stock Reservation Entry) listing the
//      batch + qty + warehouse to reserve. It stays a draft (docstatus 0) — the reservation
//      call only reads its entries, it is never submitted.
//   3. Call the Sales Order's whitelisted create_stock_reservation_entries via run_doc_method
//      with items_details pointing the SO Item at that bundle. ERPNext creates a submitted
//      Stock Reservation Entry (status "Reserved") and increases the SO Item's
//      stock_reserved_qty.
//   4. When total reserved >= total ordered across the SO, mark it Staged (custom fields).

const COMPANY = 'Molding'

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

/** Bounded-concurrency map so a wide SO fan-out can't fire hundreds of simultaneous calls. */
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

const OPEN_SO_EXCLUDE = ['Completed', 'Closed', 'Cancelled', 'On Hold']
const SO_FETCH_CONCURRENCY = 6

interface SOItemRow {
  name: string
  item_code: string
  warehouse?: string | null
  qty: number
  stock_qty?: number | null
  stock_reserved_qty?: number | null
  reserve_stock?: number | null
  delivered_qty?: number | null
}

interface SODoc {
  name: string
  customer: string
  po_no?: string | null
  delivery_date?: string | null
  status: string
  docstatus: number
  custom_staging_status?: string | null
  items: SOItemRow[]
}

/** Ordered qty of an SO Item in stock units (stock_qty when present, else qty). */
function orderedOf(it: SOItemRow): number {
  return Number(it.stock_qty ?? it.qty) || 0
}
function reservedOf(it: SOItemRow): number {
  return Number(it.stock_reserved_qty) || 0
}

export interface StagingSalesOrder {
  name: string
  customer: string
  poNo: string | null
  orderedQty: number // for the queried item (sum of its lines on this SO)
  reservedQty: number // already reserved for that item
  deliveryDate: string | null
  stagingStatus: string | null // custom_staging_status: Open | Staged | Shipped (or null)
}

/** Open Sales Orders that include `itemCode` as a line, each with that item's ordered-vs-
 *  reserved qty so the UI can show staging progress. The child doctype "Sales Order Item"
 *  is 403 for dashboard-svc, so we filter SO names with a child-table filter (allowed on the
 *  parent) and then read each SO's full doc for the line quantities. Submitted + still-open
 *  only. Read-only. */
export async function listOpenSalesOrdersForItem(itemCode: string): Promise<StagingSalesOrder[]> {
  const qs = [
    listParam('filters', [
      ['Sales Order Item', 'item_code', '=', itemCode],
      ['docstatus', '=', 1],
      ['status', 'not in', OPEN_SO_EXCLUDE],
    ]),
    listParam('fields', ['name']),
    'limit_page_length=200',
  ].join('&')
  const rows =
    (await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Sales Order?${qs}`)).data ?? []
  const names = [...new Set(rows.map((r) => r.name))]

  const orders = await mapLimit(names, SO_FETCH_CONCURRENCY, async (name) => {
    const doc = await erpnextGetDoc<SODoc>('Sales Order', name)
    let ordered = 0
    let reserved = 0
    for (const it of doc.items ?? []) {
      if (it.item_code !== itemCode) continue
      ordered += orderedOf(it)
      reserved += reservedOf(it)
    }
    const order: StagingSalesOrder = {
      name: doc.name,
      customer: doc.customer,
      poNo: doc.po_no ?? null,
      orderedQty: ordered,
      reservedQty: reserved,
      deliveryDate: doc.delivery_date ?? null,
      stagingStatus: doc.custom_staging_status ?? null,
    }
    return order
  })

  // Soonest delivery first (undated last), then by name for stability.
  return orders.sort(
    (a, b) =>
      (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999') || a.name.localeCompare(b.name)
  )
}

export interface StagingProgress {
  orderedQty: number // whole-SO totals (drives the Staged decision)
  reservedQty: number
  stagingStatus: string | null
  staged: boolean // reservedQty >= orderedQty
}

/** Whole-SO ordered-vs-reserved totals + whether it is fully covered (the Staged threshold). */
export async function getStagingProgress(soName: string): Promise<StagingProgress> {
  const doc = await erpnextGetDoc<SODoc>('Sales Order', soName)
  let ordered = 0
  let reserved = 0
  for (const it of doc.items ?? []) {
    ordered += orderedOf(it)
    reserved += reservedOf(it)
  }
  return {
    orderedQty: ordered,
    reservedQty: reserved,
    stagingStatus: doc.custom_staging_status ?? null,
    // Tiny epsilon so float rounding on stock_qty can't leave a fully-reserved order un-staged.
    staged: ordered > 0 && reserved >= ordered - 1e-6,
  }
}

// Active reservation statuses. Reserving a big SO line one pallet at a time makes each
// individual entry "Partially Reserved" (it covers only part of the line), so filtering to
// "Reserved" alone would miss real reservations and undercount the staged pallets.
const ACTIVE_SRE_STATUS = ['Reserved', 'Partially Reserved', 'Partially Delivered']

/** Names of the active (Reserved / Partially Reserved) Stock Reservation Entries on an SO. */
async function reservationNamesForSO(soName: string): Promise<string[]> {
  const qs = [
    listParam('filters', [
      ['voucher_type', '=', 'Sales Order'],
      ['voucher_no', '=', soName],
      ['status', 'in', ACTIVE_SRE_STATUS],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', ['name']),
    'limit_page_length=0',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Stock Reservation Entry?${qs}`)
  return (r.data ?? []).map((x) => x.name)
}

export interface ReserveInput {
  soName: string
  items: {
    salesOrderItem?: string // SO Item child name; resolved from soName+itemCode when omitted
    itemCode: string
    warehouse: string
    batch: string
    qty: number
  }[]
}

/** Reserve each pallet's batch to the Sales Order. For every pallet: create a Serial and Batch
 *  Bundle (Outward / Stock Reservation Entry) for its batch+qty+warehouse, then call the SO's
 *  create_stock_reservation_entries against the matching SO Item. Pallets are processed
 *  sequentially so each reservation sees the prior one's committed reserved qty (no double-count
 *  of an SO line's remaining capacity). After reserving, if the whole SO is fully covered it is
 *  marked Staged (custom_staging_status + custom_staged_at + custom_staged_pallets). Partial
 *  coverage is allowed and leaves the order Open. Returns how many new reservations were created
 *  and whether the order auto-staged. */
export async function reserveBatchesToSO(input: ReserveInput): Promise<Committed & { reserved: number; staged: boolean }> {
  const { soName, items } = input
  if (items.length === 0) return { stockEntry: null, reserved: 0, staged: false, extra: { reserved: 0, staged: false } }

  const so = await erpnextGetDoc<SODoc>('Sales Order', soName)
  if (so.docstatus !== 1 || OPEN_SO_EXCLUDE.includes(so.status)) {
    throw new Error(`Sales Order ${soName} is not open (status ${so.status})`)
  }

  // Resolve each itemCode to a matching SO line once (the line the reservation targets). A
  // pallet's batch qty accrues onto that line; multiple pallets of the same item stack on it.
  const lineFor = (itemCode: string): SOItemRow | undefined =>
    (so.items ?? []).find((l) => l.item_code === itemCode && l.reserve_stock)

  const before = new Set(await reservationNamesForSO(soName))

  for (const p of items) {
    const salesOrderItem = p.salesOrderItem ?? lineFor(p.itemCode)?.name
    if (!salesOrderItem) {
      throw new Error(`Sales Order ${soName} has no reservable line for item ${p.itemCode}`)
    }
    // Serial and Batch Bundle stays a draft; create_stock_reservation_entries only reads it.
    const sbb = await erpnextCreate<{ name: string }>('Serial and Batch Bundle', {
      company: COMPANY,
      item_code: p.itemCode,
      warehouse: p.warehouse,
      type_of_transaction: 'Outward',
      voucher_type: 'Stock Reservation Entry',
      entries: [{ batch_no: p.batch, qty: p.qty, warehouse: p.warehouse }],
    })
    await erpnextRunDocMethod('Sales Order', soName, 'create_stock_reservation_entries', {
      items_details: [
        {
          sales_order_item: salesOrderItem,
          warehouse: p.warehouse,
          qty_to_reserve: p.qty,
          serial_and_batch_bundle: sbb.name,
        },
      ],
      notify: false,
    })
  }

  const after = await reservationNamesForSO(soName)
  const reserved = after.filter((n) => !before.has(n)).length

  // Auto-mark Staged when the whole SO is fully covered.
  const progress = await getStagingProgress(soName)
  let staged = false
  if (progress.staged && progress.stagingStatus !== 'Staged') {
    await erpnextUpdate('Sales Order', soName, {
      custom_staging_status: 'Staged',
      custom_staged_at: nowStamp(),
      custom_staged_pallets: after.length,
    })
    staged = true
  } else if (progress.stagingStatus === 'Staged') {
    // Already staged (e.g. a retry) — keep the pallet count current.
    await erpnextUpdate('Sales Order', soName, { custom_staged_pallets: after.length })
    staged = true
  }

  return { stockEntry: null, reserved, staged, extra: { reserved, staged } }
}

/** ERPNext-friendly "now" (YYYY-MM-DD HH:MM:SS, local server tz per Frappe convention). */
function nowStamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export interface StagedOrder {
  name: string
  customer: string
  poNo: string | null
  stagedAt: string | null
  stagedPallets: number
  deliveryDate: string | null
}

/** Sales Orders currently marked Staged (custom_staging_status = 'Staged'). Read-only. */
export async function listStagedOrders(): Promise<StagedOrder[]> {
  const qs = [
    listParam('filters', [
      ['custom_staging_status', '=', 'Staged'],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', [
      'name',
      'customer',
      'po_no',
      'custom_staged_at',
      'custom_staged_pallets',
      'delivery_date',
    ]),
    'order_by=custom_staged_at desc',
    'limit_page_length=200',
  ].join('&')
  const rows =
    (
      await erpnextGet<{
        data: {
          name: string
          customer: string
          po_no?: string | null
          custom_staged_at?: string | null
          custom_staged_pallets?: number | null
          delivery_date?: string | null
        }[]
      }>(`/api/resource/Sales Order?${qs}`)
    ).data ?? []
  return rows.map((r) => ({
    name: r.name,
    customer: r.customer,
    poNo: r.po_no ?? null,
    stagedAt: r.custom_staged_at ?? null,
    stagedPallets: Number(r.custom_staged_pallets) || 0,
    deliveryDate: r.delivery_date ?? null,
  }))
}

/** Release an order's reservations: cancel every Reserved Stock Reservation Entry on it and
 *  reset it to Open. Used by an optional "release" action. */
export async function cancelReservationsForSO(soName: string): Promise<{ cancelled: number }> {
  await erpnextRunDocMethod('Sales Order', soName, 'cancel_stock_reservation_entries', { notify: false })
  const remaining = await reservationNamesForSO(soName)
  await erpnextUpdate('Sales Order', soName, {
    custom_staging_status: 'Open',
    custom_staged_at: null,
    custom_staged_pallets: remaining.length,
  })
  return { cancelled: remaining.length === 0 ? 1 : 0 }
}
