import {
  erpnextGet,
  erpnextGetDoc,
  erpnextCreate,
  erpnextSubmit,
  erpnextCancel,
  erpnextUpdate,
  erpnextFetchRaw,
  erpnextUploadFile,
  parseErpErrorMessage,
} from './client'
import { reservationsForBatches } from './staging'

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
  soDetail: string | null // the SO Item row the reservation targets
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
  // latest submitted Delivery Note tied to this SO (wrapper or manual scan flow)
  deliveryNote: {
    name: string
    shipped: boolean
    attachments: string[]
    signed: boolean
    driverName: string | null
  } | null
  // pallets on the latest submitted DN (what actually shipped) — the staged
  // `pallets` list empties once reservations are consumed
  shippedPallets: { palletId: string; itemCode: string; qty: number }[]
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
    listParam('fields', ['name', 'item_code', 'warehouse', 'status', 'reserved_qty', 'voucher_detail_no']),
    'limit_page_length=0',
  ].join('&')
  const sres =
    (await erpnextGet<{
      data: {
        name: string
        item_code: string
        warehouse: string
        status: string
        reserved_qty: number
        voucher_detail_no?: string | null
      }[]
    }>(`/api/resource/Stock Reservation Entry?${qs}`)).data ?? []

  // FAIL CLOSED on an unreadable SRE: this list is the authoritative staged set
  // that Complete Shipment validates scans against — silently dropping one
  // could make a partial load look exact (codex review 2026-07-03).
  const palletLists = await mapLimit(sres, SRE_FETCH_CONCURRENCY, async (s) => {
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
        // the SO Item row this reservation targets — keeps multi-line SOs
        // (same item on several release lines) shipping against the right line
        soDetail: s.voucher_detail_no ?? null,
      }))
  })
  // One pallet can appear in only one active reservation for this SO; dedupe defensively.
  const pallets = Array.from(
    new Map(palletLists.flat().map((p) => [p.palletId, p])).values()
  ).sort((a, b) => a.palletId.localeCompare(b.palletId))

  // Latest submitted DN on this SO (drives the shipped view / reprint / undo).
  const dnQs = [
    listParam('filters', [
      ['custom_ship_against_so', '=', soName],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', ['name', 'custom_shipped', 'custom_signed_at', 'custom_driver_name']),
    'order_by=creation desc',
    'limit_page_length=1',
  ].join('&')
  const dnRow =
    (await erpnextGet<{
      data: { name: string; custom_shipped?: number; custom_signed_at?: string | null; custom_driver_name?: string | null }[]
    }>(`/api/resource/Delivery Note?${dnQs}`)).data?.[0] ?? null
  let dnAttachments: string[] = []
  let shippedPallets: { palletId: string; itemCode: string; qty: number }[] = []
  if (dnRow) {
    const dnDoc = await erpnextGetDoc<{ items?: { batch_no?: string | null; item_code: string; qty: number }[] }>(
      'Delivery Note',
      dnRow.name
    ).catch(() => null)
    shippedPallets = (dnDoc?.items ?? [])
      .filter((i) => i.batch_no)
      .map((i) => ({ palletId: String(i.batch_no), itemCode: i.item_code, qty: Number(i.qty) || 0 }))
    const fq = [
      listParam('filters', [
        ['attached_to_doctype', '=', 'Delivery Note'],
        ['attached_to_name', '=', dnRow.name],
      ]),
      listParam('fields', ['file_name']),
      'limit_page_length=0',
    ].join('&')
    dnAttachments = (
      (await erpnextGet<{ data: { file_name: string }[] }>(`/api/resource/File?${fq}`).catch(() => ({ data: [] })))
        .data ?? []
    ).map((f) => f.file_name)
  }

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
    deliveryNote: dnRow
      ? {
          name: dnRow.name,
          shipped: !!dnRow.custom_shipped,
          attachments: dnAttachments,
          signed: !!dnRow.custom_signed_at,
          driverName: dnRow.custom_driver_name ?? null,
        }
      : null,
    shippedPallets,
  }
}

export interface PalletLookup {
  palletId: string
  itemCode: string | null // null -> no such pallet
  disabled: boolean
  onHandQty: number
  reservedTo: { so: string; customer: string | null } | null
}

/** Diagnose a scanned/typed pallet that is NOT in the order's staged set, so the
 *  floor sees WHY it's red: wrong product, staged to another order, unknown code,
 *  or a disabled (superseded) label. Read-only; no prices. */
export async function lookupPalletForFulfillment(palletId: string): Promise<PalletLookup> {
  const batch = await erpnextGetDoc<{ item?: string; disabled?: number }>('Batch', palletId).catch(() => null)
  if (!batch?.item) {
    return { palletId, itemCode: null, disabled: false, onHandQty: 0, reservedTo: null }
  }

  const [qtyRes, resMap] = await Promise.all([
    erpnextGet<{ message?: { warehouse: string; qty: number }[] | { warehouse: string; qty: number } }>(
      `/api/method/erpnext.stock.doctype.batch.batch.get_batch_qty?${new URLSearchParams({ batch_no: palletId })}`
    ).catch(() => ({ message: [] as { warehouse: string; qty: number }[] })),
    reservationsForBatches([palletId]).catch(() => ({}) as Awaited<ReturnType<typeof reservationsForBatches>>),
  ])
  const rows = Array.isArray(qtyRes.message) ? qtyRes.message : qtyRes.message ? [qtyRes.message] : []
  const onHand = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)
  const reservation = resMap[palletId]

  return {
    palletId,
    itemCode: batch.item,
    disabled: !!batch.disabled,
    onHandQty: onHand,
    reservedTo: reservation ? { so: reservation.so, customer: reservation.customer } : null,
  }
}

// ─── Complete Shipment (Phase 3) ───

const COMPANY = 'Molding'
export const BOL_FORMAT = 'BOL'
export const PACKING_SLIP_FORMAT = 'Packing Slip - Entech'

/** Thrown when the ERPNext safety gate (or any validation) rejects the
 *  shipment — carries the server's user-facing (often bilingual) message. */
export class ShipmentRejectedError extends Error {}

/** Redact money-shaped fragments from a server message before it reaches the
 *  shipping floor (currency symbols/amounts, "rate/price/amount N"). */
function scrubMoney(s: string): string {
  return s
    .replace(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g, '[…]')
    .replace(/\b(rate|price|amount|total|valuation)\b[^.;,]{0,20}?\d[\d,]*(?:\.\d+)?/gi, '$1 […]')
}

export interface CompleteShipmentInput {
  soName: string
  scannedPallets: string[] // what the floor scanned — revalidated against live ERPNext state
  userName: string // dashboard identity, recorded as custom_shipped_by
  customerPartNos: Record<string, string> // itemCode -> the customer's own P/N (packing slip)
}

export interface CompleteShipmentResult {
  dn: string
  so: string
  stagingStatus: string | null
  attachedBol: boolean
  attachedPackingSlip: boolean
  // set when a post-submit step failed — the shipment ITSELF is done (stock
  // relieved), the UI must show success plus this warning, never an error
  warning: 'mark_shipped_failed' | null
}

/** Fetch a print-format PDF for a DN. Returns null (not throws) on failure so
 *  document generation can't break the shipment itself. */
async function fetchDnPdf(dn: string, format: string): Promise<Uint8Array | null> {
  try {
    const qs = new URLSearchParams({ doctype: 'Delivery Note', name: dn, format })
    const res = await erpnextFetchRaw(`/api/method/frappe.utils.print_format.download_pdf?${qs}`)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.length > 4 && buf[0] === 0x25 ? buf : null // starts with %PDF
  } catch {
    return null
  }
}

interface DnDraft {
  name: string
  docstatus: number
  items?: { batch_no?: string | null }[]
}

/** Find an existing wrapper-created DN for this SO with exactly this pallet
 *  set: a submitted one means a double-tap/retry — reuse it; a draft means a
 *  crash between create and submit — resume it. */
async function findExistingDn(soName: string, pallets: Set<string>): Promise<DnDraft | null> {
  const qs = [
    `filters=${encodeURIComponent(JSON.stringify([
      ['custom_ship_against_so', '=', soName],
      ['docstatus', 'in', [0, 1]],
    ]))}`,
    `fields=${encodeURIComponent(JSON.stringify(['name', 'docstatus']))}`,
    'order_by=creation desc',
    'limit_page_length=10',
  ].join('&')
  const rows =
    (await erpnextGet<{ data: { name: string; docstatus: number }[] }>(`/api/resource/Delivery Note?${qs}`)).data ?? []
  for (const row of rows) {
    const doc = await erpnextGetDoc<DnDraft>('Delivery Note', row.name)
    const batches = new Set((doc.items ?? []).map((i) => String(i.batch_no ?? '')).filter(Boolean))
    if (batches.size === pallets.size && [...pallets].every((p) => batches.has(p))) return doc
  }
  return null
}

/** The whole "Complete Shipment" tap, server-side:
 *  1. revalidate the scanned set against the LIVE staged pallets (exact match),
 *  2. create the Delivery Note (one row per pallet; no rate/warehouse — the
 *     ERPNext Before-Validate script fills rate from the SO and repoints the
 *     warehouse from the batch),
 *  3. submit (fires the DN Scan Safety Gate; stock is relieved HERE and the
 *     order's reservations are consumed via the so_detail linkage — verified
 *     live 2026-07-02),
 *  4. mark custom_shipped (fires the shipped rollup to the SO),
 *  5. generate + attach the BOL and packing slip PDFs (best-effort — a PDF
 *     hiccup never undoes a completed shipment; reprint regenerates on demand).
 *  Idempotent against double-taps: an existing DN with the same pallet set is
 *  reused (submitted -> continue from step 4; draft -> resume from step 3). */
export async function completeShipment(input: CompleteShipmentInput): Promise<CompleteShipmentResult> {
  const { soName, userName, customerPartNos } = input
  const scanned = new Set(input.scannedPallets.map((p) => p.trim().toUpperCase()).filter(Boolean))

  const order = await getFulfillmentOrder(soName)
  const staged = new Map(order.pallets.map((p) => [p.palletId.toUpperCase(), p]))

  // Idempotent retry FIRST: if a DN with this exact pallet set already exists
  // (double-tap, or a retry after the first attempt flipped the SO to Shipped),
  // continue from where it left off instead of rejecting (codex review).
  const existing = await findExistingDn(
    soName,
    new Set(staged.size ? staged.keys() : scanned)
  )

  if (!existing) {
    if (order.stagingStatus === 'Shipped') {
      throw new ShipmentRejectedError(`Order ${soName} is already shipped`)
    }
    if (staged.size === 0) throw new ShipmentRejectedError(`Order ${soName} has no staged pallets`)
    const missing = [...staged.keys()].filter((p) => !scanned.has(p))
    const extra = [...scanned].filter((p) => !staged.has(p))
    if (missing.length || extra.length) {
      throw new ShipmentRejectedError(
        `Scanned pallets do not match the staged records` +
          (missing.length ? ` — missing: ${missing.join(', ')}` : '') +
          (extra.length ? ` — not staged: ${extra.join(', ')}` : '')
      )
    }
  }
  const lineByItem = new Map(order.lines.map((l) => [l.itemCode, l]))

  // 1-2) create or reuse the DN
  let dn: string
  let alreadySubmitted = false
  if (existing) {
    dn = existing.name
    alreadySubmitted = existing.docstatus === 1
  } else {
    const items = order.pallets.map((p) => ({
      item_code: p.itemCode,
      qty: p.qty,
      batch_no: p.palletId,
      use_serial_batch_fields: 1,
      against_sales_order: soName,
      // prefer the SO line the RESERVATION targets — an SO can carry the same
      // item on several release lines and itemCode alone would collapse them
      so_detail: p.soDetail ?? lineByItem.get(p.itemCode)?.soItem,
      custom_customer_part_no: customerPartNos[p.itemCode] ?? null,
      // rate + warehouse intentionally omitted — server scripts own them
    }))
    const created = await erpnextCreate<{ name: string }>('Delivery Note', {
      customer: order.customer,
      company: COMPANY,
      custom_ship_against_so: soName,
      items,
    })
    dn = created.name
  }

  // 3) submit — the scan safety gate runs here. Its message is shown to the
  // floor, so scrub any money-shaped fragments a generic frappe validation
  // could carry (hard rule: no prices in this UI).
  if (!alreadySubmitted) {
    const fresh = await erpnextGetDoc('Delivery Note', dn)
    try {
      await erpnextSubmit(fresh)
    } catch (e) {
      const msg = parseErpErrorMessage(e instanceof Error ? e.message : String(e))
      throw new ShipmentRejectedError(scrubMoney(msg))
    }
  }

  // From here on the shipment EXISTS (stock is relieved) — nothing below may
  // throw, or the operator would see "failed" for a completed shipment and
  // retry unsafely (codex review). Failures degrade to warnings instead.

  // 4) mark shipped (allow_on_submit custom fields; fires the SO rollup)
  let warning: CompleteShipmentResult['warning'] = null
  try {
    await erpnextUpdate('Delivery Note', dn, {
      custom_shipped: 1,
      custom_shipped_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      custom_shipped_by: userName || 'dashboard',
    })
  } catch (e) {
    console.error(`completeShipment ${dn}: mark-shipped failed (shipment itself is submitted):`, e)
    warning = 'mark_shipped_failed'
  }

  // 5) documents — best-effort, never fail the shipment over a PDF. A retry
  // of an already-shipped DN skips files that are already attached.
  const alreadyAttached = new Set(
    (
      (await erpnextGet<{ data: { file_name: string }[] }>(
        `/api/resource/File?${listParam('filters', [
          ['attached_to_doctype', '=', 'Delivery Note'],
          ['attached_to_name', '=', dn],
        ])}&${listParam('fields', ['file_name'])}&limit_page_length=0`
      ).catch(() => ({ data: [] }))).data ?? []
    ).map((f) => f.file_name)
  )
  const attach = async (format: string, fileName: string): Promise<boolean> => {
    if (alreadyAttached.has(fileName)) return true
    const pdf = await fetchDnPdf(dn, format)
    if (!pdf) return false
    try {
      await erpnextUploadFile({
        fileName,
        bytes: pdf,
        attachedToDoctype: 'Delivery Note',
        attachedToName: dn,
      })
      return true
    } catch {
      return false
    }
  }
  const [attachedBol, attachedPackingSlip] = await Promise.all([
    attach(BOL_FORMAT, `BOL-${dn}.pdf`),
    attach(PACKING_SLIP_FORMAT, `PackingSlip-${dn}.pdf`),
  ])

  const stagingStatus = await erpnextGetDoc<{ custom_staging_status?: string | null }>('Sales Order', soName)
    .then((s) => s.custom_staging_status ?? null)
    .catch(() => null)
  return {
    dn,
    so: soName,
    stagingStatus,
    attachedBol,
    attachedPackingSlip,
    warning,
  }
}

export interface UndoShipmentResult {
  dn: string
  so: string | null
  stagingStatus: string | null
}

/** Recompute the SO's staging status after an undo, mirroring the ERPNext
 *  "DN Shipped Rollup To SO" server script exactly. That script fires on
 *  After Save (Submitted) — a DN CANCEL doesn't trigger it, so without this the
 *  order stays "Shipped" after an undo (found in live testing 2026-07-02). */
async function recomputeStagingAfterUndo(soName: string): Promise<string | null> {
  const so = await erpnextGetDoc<{
    custom_staging_status?: string | null
    custom_staged_pallets?: number | null
    items: { item_code: string; qty: number }[]
  }>('Sales Order', soName)

  const ordered: Record<string, number> = {}
  for (const it of so.items ?? []) ordered[it.item_code] = (ordered[it.item_code] ?? 0) + (Number(it.qty) || 0)

  const qs = [
    listParam('filters', [
      ['custom_ship_against_so', '=', soName],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', ['name', 'custom_shipped']),
    'limit_page_length=0',
  ].join('&')
  const dns =
    (await erpnextGet<{ data: { name: string; custom_shipped?: number }[] }>(
      `/api/resource/Delivery Note?${qs}`
    )).data ?? []

  const shipped: Record<string, number> = {}
  let anyShipped = false
  for (const dn of dns) {
    if (!dn.custom_shipped) continue
    anyShipped = true
    const doc = await erpnextGetDoc<{ items?: { item_code: string; qty: number }[] }>('Delivery Note', dn.name)
    for (const it of doc.items ?? []) shipped[it.item_code] = (shipped[it.item_code] ?? 0) + (Number(it.qty) || 0)
  }
  let fully = anyShipped
  for (const ic of Object.keys(ordered)) {
    if ((shipped[ic] ?? 0) + 1e-6 < ordered[ic]) {
      fully = false
      break
    }
  }
  const cur = so.custom_staging_status ?? null
  let next = cur
  if (fully) next = 'Shipped'
  else if (cur === 'Shipped') next = (Number(so.custom_staged_pallets) || 0) > 0 ? 'Staged' : 'Open'
  if (next && next !== cur) {
    await erpnextUpdate('Sales Order', soName, { custom_staging_status: next })
  }
  return next
}

/** Undo a completed shipment: cancel the DN. ERPNext returns the stock to the
 *  pallets, restores the order's reservations, and the shipped rollup reverts
 *  the SO (all verified live 2026-07-02). Only wrapper-shape DNs (tied to an
 *  SO via custom_ship_against_so) can be undone from the dashboard. */
export async function undoShipment(dnName: string): Promise<UndoShipmentResult> {
  const doc = await erpnextGetDoc<{
    name: string
    docstatus: number
    custom_ship_against_so?: string | null
  }>('Delivery Note', dnName)
  const so = doc.custom_ship_against_so ?? null
  if (doc.docstatus !== 1 || !so) {
    throw new ShipmentRejectedError(`Delivery Note ${dnName} is not an undoable dashboard shipment`)
  }
  try {
    await erpnextCancel('Delivery Note', dnName)
  } catch (e) {
    throw new ShipmentRejectedError(parseErpErrorMessage(e instanceof Error ? e.message : String(e)))
  }
  const stagingStatus = await recomputeStagingAfterUndo(so)
  return { dn: dnName, so, stagingStatus }
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
