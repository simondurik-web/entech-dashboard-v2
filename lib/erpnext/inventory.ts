import { randomBytes } from 'crypto'
import {
  erpnextCreate,
  erpnextGet,
  erpnextGetDoc,
  erpnextSubmit,
  erpnextUpdate,
  erpnextCallGet,
} from './client'
import type { Committed } from './operation'
import { reservationsForBatches, releaseBatchReservation, reserveBatchesToSO } from './staging'

// ERPNext stock operations for the inventory-ops module. Company is fixed to
// Molding (the only operating company). All writes are server-side only and
// driven through runInventoryOp (idempotency + state machine).

const COMPANY = 'Molding'

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

/** Sanitize user text before it goes into a Stock Entry `remarks`. Strips square brackets so
 *  a crafted reason can't smuggle an `[op:<key>]` token into remarks — reconcileStockEntry
 *  matches that token with a LIKE, so an injected one could otherwise be reconciled against
 *  the wrong document. Also caps the length. */
function safeRemark(text: string, max = 120): string {
  return (text ?? '').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

// ─── Pallet id ───────────────────────────────────────────────────────────────
// Pallet ids are short, human-typeable codes that double as the QR payload. We
// use Crockford base32 (digits + letters, MINUS I/L/O/U which get confused with
// 1/0) so a code read off a label is unambiguous. The id is the ERPNext Batch
// name, which is globally unique by definition, so two pallets can never share
// one. We start at 4 characters (~1M codes) and AUTO-GROW: once a length is so
// saturated that random picks keep colliding, the generator silently moves to
// the next length (5 -> ~33M, 6 -> ~1B). A 4-char and a 5-char code are just
// different strings, so growth needs no migration and never breaks old labels.
const PALLET_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 (no I/L/O/U)
const PALLET_MIN_LEN = 4
const PALLET_MAX_LEN = 10
// Consecutive collisions at one length before we grow. 8 misses means the space
// is ~99.6%+ full, so in practice this only fires near true exhaustion.
const PALLET_GROW_AFTER = 8

/** One random base32 code of the given length. `byte % 32` is unbiased because
 *  256 is an exact multiple of 32. */
function randomPalletCode(len: number): string {
  const bytes = randomBytes(len)
  let code = ''
  for (let i = 0; i < len; i++) code += PALLET_ALPHABET[bytes[i] % 32]
  return code
}

/** True if a Batch with this id already exists in ERPNext. */
async function batchExists(id: string): Promise<boolean> {
  return erpnextGet(`/api/resource/Batch/${encodeURIComponent(id)}`)
    .then(() => true)
    .catch(() => false)
}

/** Mint a fresh, unique pallet id. Uniqueness is enforced against the live
 *  ERPNext Batch table (the Batch name is the primary key), so the returned code
 *  is guaranteed not to collide with any existing pallet. Grows the length
 *  automatically when the current length is saturated. */
export async function generatePalletId(): Promise<string> {
  let len = PALLET_MIN_LEN
  let missesAtLen = 0
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = randomPalletCode(len)
    if (!(await batchExists(code))) return code
    if (++missesAtLen >= PALLET_GROW_AFTER && len < PALLET_MAX_LEN) {
      len++
      missesAtLen = 0
    }
  }
  throw new Error('Could not allocate a unique pallet id')
}

/** Validate a destination warehouse is a real, enabled storage bin for this company.
 *  Throws with a clear message so the caller marks the op failed_pre_erp (no ERP write). */
async function preflightWarehouse(warehouse: string): Promise<void> {
  const wh = await erpnextGetDoc<{ disabled?: number; is_group?: number; company?: string }>(
    'Warehouse',
    warehouse
  ).catch(() => null)
  if (!wh) throw new Error(`Warehouse "${warehouse}" not found`)
  if (wh.is_group) throw new Error(`Warehouse "${warehouse}" is a group, not a storage bin`)
  if (wh.disabled) throw new Error(`Warehouse "${warehouse}" is disabled`)
  if (wh.company && wh.company !== COMPANY) {
    throw new Error(`Warehouse "${warehouse}" belongs to ${wh.company}, not ${COMPANY}`)
  }
}

/** Validate the destination warehouse + that the item is batch-tracked. Throws
 *  with a clear message so the caller marks the op failed_pre_erp (no ERP write). */
async function preflight(itemCode: string, warehouse: string): Promise<{ itemName: string; uom: string }> {
  const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string; has_batch_no?: number }>(
    'Item',
    itemCode
  )
  if (!item.has_batch_no) {
    throw new Error(`Item ${itemCode} is not batch-tracked; cannot create a pallet`)
  }
  await preflightWarehouse(warehouse)
  return { itemName: item.item_name ?? itemCode, uom: item.stock_uom ?? 'Nos' }
}

/** Guard before any mutate/reprint: the batch must exist, belong to `itemCode`, and
 *  (by default) be active. Stops a forged/typo'd itemCode from acting on the wrong
 *  pallet or a disabled (superseded/removed) one. Throws -> failed_pre_erp (no write). */
export async function assertBatchItem(batch: string, itemCode: string, requireActive = true): Promise<void> {
  const b = await erpnextGetDoc<{ item?: string; disabled?: number }>('Batch', batch).catch(() => null)
  if (!b) throw new Error(`Pallet ${batch} not found`)
  if (b.item !== itemCode) throw new Error(`Pallet ${batch} does not belong to ${itemCode}`)
  if (requireActive && b.disabled) throw new Error(`Pallet ${batch} is disabled (superseded or removed)`)
}

async function submitStockEntry(doc: Record<string, unknown>): Promise<string> {
  const draft = await erpnextCreate<{ name: string }>('Stock Entry', doc)
  const fresh = await erpnextGetDoc('Stock Entry', draft.name)
  const submitted = await erpnextSubmit<{ name?: string }>(fresh)
  return submitted.name ?? draft.name
}

/** Find a submitted Stock Entry stamped with this op key (reconcile path). */
export async function reconcileStockEntry(opKey: string): Promise<string | null> {
  const safe = opKey.replace(/[\\%_]/g, '\\$&') // escape LIKE metacharacters
  const qs = [
    listParam('filters', [
      ['remarks', 'like', `%[op:${safe}]%`],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', ['name']),
    'limit_page_length=1',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Stock Entry?${qs}`)
  return r.data?.[0]?.name ?? null
}

export interface AddInventoryInput {
  itemCode: string
  qty: number
  warehouse: string
  opKey: string
  batch: string // pre-minted unique pallet id (see generatePalletId); reused on retry
  weightLb?: number // optional pallet weight, captured at label print (Simon 2026-07-03)
  dims?: string // optional pallet dimensions, e.g. "48x40x60"
}

export interface AddInventoryResult extends Committed {
  itemName: string
  uom: string
}

/** Receive a new pallet: create the (deterministic) Batch, post a Material
 *  Receipt binding it (use_serial_batch_fields + batch_no both required), submit.
 *  The Stock Entry is stamped [op:<key>] for reconcile. */
export async function addInventory(input: AddInventoryInput): Promise<AddInventoryResult> {
  const { itemCode, qty, warehouse, opKey, batch, weightLb, dims } = input
  const { itemName, uom } = await preflight(itemCode, warehouse)

  // Batch create is skip-if-exists (the id is reserved per op + reused on retry),
  // so a retry of the same add reuses the batch instead of orphaning a new one.
  if (!(await erpnextGet(`/api/resource/Batch/${encodeURIComponent(batch)}`).then(() => true).catch(() => false))) {
    await erpnextCreate('Batch', {
      batch_id: batch,
      item: itemCode,
      custom_pallet_qty: qty,
      ...(weightLb ? { custom_pallet_weight: weightLb } : {}),
      ...(dims ? { custom_pallet_dims: dims } : {}),
    })
  }

  const stockEntry = await submitStockEntry({
    stock_entry_type: 'Material Receipt',
    company: COMPANY,
    remarks: `Dashboard add [op:${opKey}]`,
    items: [
      {
        item_code: itemCode,
        qty,
        t_warehouse: warehouse,
        use_serial_batch_fields: 1,
        batch_no: batch,
        allow_zero_valuation_rate: 1,
        uom,
        stock_uom: uom,
        conversion_factor: 1,
      },
    ],
  })

  return { batch, stockEntry, itemName, uom }
}

interface BatchLocation {
  warehouse: string // the warehouse holding the most stock
  qty: number // TOTAL on-hand across all warehouses
  split: boolean // true if the batch has stock in more than one warehouse
}

/** Current on-hand for a pallet/batch: total qty, primary warehouse, and whether
 *  it is split across bins (adjust/remove refuse split pallets to avoid guessing). */
export async function getBatchLocation(batch: string, itemCode: string): Promise<BatchLocation | null> {
  // ignore_reserved_stock: with item_code present, get_batch_qty silently
  // subtracts Stock-Reservation qty — a 352-pc pallet staged for 319 reported
  // "33", which lied on the search card AND would have made a reprint/remove
  // target the wrong qty (Simon's WPH1-02 report, 2026-07-03). The dashboard
  // always wants PHYSICAL qty here; reservations are shown as their own badge.
  const r = await erpnextCallGet<{ message?: { warehouse: string; qty: number }[] }>(
    'erpnext.stock.doctype.batch.batch.get_batch_qty',
    { batch_no: batch, item_code: itemCode, ignore_reserved_stock: '1' }
  )
  const positive = (r.message ?? []).filter((x) => x.qty > 0)
  if (positive.length === 0) return null
  const total = positive.reduce((s, x) => s + x.qty, 0)
  const primary = positive.reduce((a, b) => (b.qty > a.qty ? b : a))
  return { warehouse: primary.warehouse, qty: total, split: positive.length > 1 }
}

export interface Pallet {
  batch: string
  warehouse: string
  qty: number
  weightLb?: number
  dims?: string
}

/** On-hand pallets (batches) for an item, one row per (batch, warehouse). Backed by
 *  enumeratePallets, so it is COMPLETE (no page cap), bounded-concurrency, and attributes
 *  a split batch's qty to each warehouse correctly (getBatchLocation collapses splits to
 *  the primary warehouse with the TOTAL qty, which mis-binned split pallets). */
export async function listPallets(itemCode: string): Promise<Pallet[]> {
  const locs = await enumeratePallets([itemCode])
  return locs
    .map((l) => ({ batch: l.batch, warehouse: l.warehouse, qty: l.qty, weightLb: l.weightLb, dims: l.dims }))
    .sort((a, b) => a.batch.localeCompare(b.batch))
}

// ─── Bin contents + full inventory (Locations view + reports) ──────────────────
export interface BinContentItem {
  itemCode: string
  itemName: string
  uom: string
  qty: number
  pallets: { batch: string; qty: number }[]
}

/** Run an async fn over items with BOUNDED concurrency (so a big inventory doesn't fire
 *  thousands of simultaneous ERPNext calls and exhaust connections / trip rate limits).
 *  Slower than Promise.all on huge sets, but stable — the report just takes longer. */
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

interface PalletLoc {
  item: string
  batch: string
  warehouse: string
  qty: number
  weightLb?: number
  dims?: string
}

// Bounded concurrency for the per-batch get_batch_qty fan-out.
const BATCH_QTY_CONCURRENCY = 10

/** Every active pallet (batch) for the given item codes, with its warehouse + qty.
 *  One Batch list query per 100 codes, then a get_batch_qty per batch at bounded
 *  concurrency. get_batch_qty returns all warehouses for a batch in one call, so the
 *  total call count is ~(#batches), not (#items × #batches). */
async function enumeratePallets(itemCodes: string[]): Promise<PalletLoc[]> {
  if (itemCodes.length === 0) return []
  const batches: { name: string; item: string; custom_pallet_weight?: number; custom_pallet_dims?: string }[] = []
  for (let i = 0; i < itemCodes.length; i += 100) {
    const chunk = itemCodes.slice(i, i + 100)
    const qs = [
      listParam('filters', [
        ['item', 'in', chunk],
        ['disabled', '=', 0],
      ]),
      listParam('fields', ['name', 'item', 'custom_pallet_weight', 'custom_pallet_dims']),
      'limit_page_length=0',
    ].join('&')
    batches.push(
      ...((await erpnextGet<{
        data: { name: string; item: string; custom_pallet_weight?: number; custom_pallet_dims?: string }[]
      }>(`/api/resource/Batch?${qs}`)).data ?? [])
    )
  }
  const perBatch = await mapLimit(batches, BATCH_QTY_CONCURRENCY, async (b) => {
    // Retry once on a transient blip, then PROPAGATE: a report that silently omits pallets
    // is worse than one that fails (the operator would trust an incomplete audit). The
    // throw bubbles up so the route returns 502 and the UI shows a retryable error.
    let lastErr: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await erpnextCallGet<{ message?: { warehouse: string; qty: number }[] }>(
          'erpnext.stock.doctype.batch.batch.get_batch_qty',
          // ignore_reserved_stock: physical qty, not net-of-reservations (see
          // getBatchLocation — same WPH1-02 "33 of 352" lie in every pallet list).
          { batch_no: b.name, item_code: b.item, ignore_reserved_stock: '1' }
        )
        return (r.message ?? [])
          .filter((x) => x.qty > 0)
          .map((x) => ({
            item: b.item,
            batch: b.name,
            warehouse: x.warehouse,
            qty: x.qty,
            weightLb: b.custom_pallet_weight || undefined,
            dims: b.custom_pallet_dims || undefined,
          }))
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr
  })
  return perBatch.flat()
}

/** Weight/dims for a set of pallet batches (chunked 'in' query; best-effort).
 *  Feeds the printed/deleted label history so the pallet's physical data shows
 *  right in the row (Simon 2026-07-03). */
export async function batchWeightDims(
  batches: string[]
): Promise<Map<string, { weightLb: number | null; dims: string | null }>> {
  const out = new Map<string, { weightLb: number | null; dims: string | null }>()
  const uniq = [...new Set(batches.filter(Boolean))]
  for (let i = 0; i < uniq.length; i += 100) {
    const chunk = uniq.slice(i, i + 100)
    const qs = [
      listParam('filters', [['name', 'in', chunk]]),
      listParam('fields', ['name', 'custom_pallet_weight', 'custom_pallet_dims']),
      'limit_page_length=0',
    ].join('&')
    const rows =
      (await erpnextGet<{ data: { name: string; custom_pallet_weight?: number; custom_pallet_dims?: string }[] }>(
        `/api/resource/Batch?${qs}`
      )).data ?? []
    for (const r of rows) {
      out.set(r.name, { weightLb: r.custom_pallet_weight || null, dims: r.custom_pallet_dims || null })
    }
  }
  return out
}

/** name + uom for a set of item codes (chunked 'in' queries). */
export async function itemNameMap(codes: string[]): Promise<Map<string, { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }>> {
  const nameMap = new Map<string, { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }>()
  for (let i = 0; i < codes.length; i += 100) {
    const chunk = codes.slice(i, i + 100)
    const qs = [
      listParam('filters', [['item_code', 'in', chunk]]),
      listParam('fields', ['item_code', 'item_name', 'stock_uom', 'has_batch_no', 'custom_pieces_per_pack']),
      'limit_page_length=0',
    ].join('&')
    const rows = (await erpnextGet<{ data: { item_code: string; item_name: string; stock_uom: string; has_batch_no?: number; custom_pieces_per_pack?: number }[] }>(`/api/resource/Item?${qs}`)).data ?? []
    for (const r of rows) nameMap.set(r.item_code, { itemName: r.item_name, uom: r.stock_uom, hasBatch: !!r.has_batch_no, piecesPerPack: Number(r.custom_pieces_per_pack) || 1 })
  }
  return nameMap
}

/** Everything stored in one bin: each item with its on-hand qty and the pallet ids
 *  (+ qty) of that item IN THIS BIN. Read-only; for the Locations view + bin report. */
export async function getBinContents(warehouse: string): Promise<{ items: BinContentItem[]; palletsTruncated: boolean }> {
  const binQs = [
    listParam('filters', [
      ['warehouse', '=', warehouse],
      ['actual_qty', '>', 0],
    ]),
    listParam('fields', ['item_code', 'actual_qty']),
    'limit_page_length=0',
  ].join('&')
  const binRows = (await erpnextGet<{ data: { item_code: string; actual_qty: number }[] }>(`/api/resource/Bin?${binQs}`)).data ?? []
  if (binRows.length === 0) return { items: [], palletsTruncated: false }

  const codes = [...new Set(binRows.map((b) => b.item_code))]
  const nameMap = await itemNameMap(codes)

  const byItem = new Map<string, BinContentItem>()
  for (const b of binRows) {
    const existing = byItem.get(b.item_code)
    if (existing) {
      existing.qty += b.actual_qty
      continue
    }
    const meta = nameMap.get(b.item_code)
    byItem.set(b.item_code, {
      itemCode: b.item_code,
      itemName: meta?.itemName ?? b.item_code,
      uom: meta?.uom ?? '',
      qty: b.actual_qty,
      pallets: [],
    })
  }

  // Pallet ids for THIS bin (bounded concurrency; no item cap — Simon wants the full
  // picture even if it's slower for a large bin).
  const pallets = (await enumeratePallets(codes)).filter((p) => p.warehouse === warehouse)
  for (const p of pallets) {
    byItem.get(p.item)?.pallets.push({ batch: p.batch, qty: p.qty })
  }
  for (const it of byItem.values()) it.pallets.sort((a, b) => a.batch.localeCompare(b.batch))

  const itemsArr = [...byItem.values()].sort((a, b) => b.qty - a.qty || a.itemName.localeCompare(b.itemName))
  return { items: itemsArr, palletsTruncated: false }
}

export interface InventoryRow {
  itemCode: string
  itemName: string
  uom: string
  warehouse: string
  qty: number
  pallets: { batch: string; qty: number }[]
}

/** The full item × bin × qty matrix for the whole facility, each cell enriched with its
 *  pallet ids. Drives the full-inventory spreadsheet export (grouped by bin / product).
 *  Bounded concurrency keeps it stable on a large facility — slower, never a storm. */
export async function getFullInventory(): Promise<InventoryRow[]> {
  const binQs = [
    listParam('filters', [['actual_qty', '>', 0]]),
    listParam('fields', ['item_code', 'warehouse', 'actual_qty']),
    'limit_page_length=0',
  ].join('&')
  const binRows = (await erpnextGet<{ data: { item_code: string; warehouse: string; actual_qty: number }[] }>(`/api/resource/Bin?${binQs}`)).data ?? []
  if (binRows.length === 0) return []

  const codes = [...new Set(binRows.map((b) => b.item_code))]
  const nameMap = await itemNameMap(codes)

  // Pallet ids keyed by item+warehouse so each (item, bin) cell gets its own list.
  const pallets = await enumeratePallets(codes)
  const palletsByCell = new Map<string, { batch: string; qty: number }[]>()
  for (const p of pallets) {
    const key = `${p.item} ${p.warehouse}`
    const arr = palletsByCell.get(key)
    if (arr) arr.push({ batch: p.batch, qty: p.qty })
    else palletsByCell.set(key, [{ batch: p.batch, qty: p.qty }])
  }

  return binRows.map((b) => {
    const meta = nameMap.get(b.item_code)
    return {
      itemCode: b.item_code,
      itemName: meta?.itemName ?? b.item_code,
      uom: meta?.uom ?? '',
      warehouse: b.warehouse,
      // Non-serialized items are stored in BOXES (1 stock unit = 1 box) — report the PART
      // count (boxes x pieces-per-pack) so audit/valuation values parts, not boxes (e.g.
      // 20 boxes of EB-BRN @500 = 10,000). Serialized pallets already track pieces.
      qty: meta && !meta.hasBatch ? b.actual_qty * meta.piecesPerPack : b.actual_qty,
      pallets: (palletsByCell.get(`${b.item_code} ${b.warehouse}`) ?? []).sort((a, c) => a.batch.localeCompare(c.batch)),
    }
  })
}

export interface AdjustResult extends Committed {
  itemName: string
  uom: string
  newQty: number
}

/** Correct a pallet's on-hand quantity to `newQty` by posting the delta as a
 *  Material Receipt (increase) or Material Issue (decrease) against the batch. */
export async function adjustInventory(input: {
  batch: string
  itemCode: string
  newQty: number
  opKey: string
}): Promise<AdjustResult> {
  const { batch, itemCode, newQty, opKey } = input
  await assertBatchItem(batch, itemCode)
  const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
  const itemName = item.item_name ?? itemCode
  const uom = item.stock_uom ?? 'Nos'

  const loc = await getBatchLocation(batch, itemCode)
  if (!loc) throw new Error(`Pallet ${batch} has no stock to adjust`)
  if (loc.split) throw new Error(`Pallet ${batch} is split across multiple bins; consolidate in ERPNext first`)
  const delta = newQty - loc.qty

  let stockEntry: string | null = null
  if (delta !== 0) {
    const increase = delta > 0
    const row: Record<string, unknown> = {
      item_code: itemCode,
      qty: Math.abs(delta),
      use_serial_batch_fields: 1,
      batch_no: batch,
      allow_zero_valuation_rate: 1,
      uom,
      stock_uom: uom,
      conversion_factor: 1,
    }
    row[increase ? 't_warehouse' : 's_warehouse'] = loc.warehouse
    stockEntry = await submitStockEntry({
      stock_entry_type: increase ? 'Material Receipt' : 'Material Issue',
      company: COMPANY,
      remarks: `Dashboard adjust [op:${opKey}]`,
      items: [row],
    })
  }
  await erpnextUpdate('Batch', batch, { custom_pallet_qty: newQty })

  return { batch, stockEntry, itemName, uom, newQty }
}

export interface RemoveResult extends Committed {
  removedQty: number
}

/** Remove a pallet from stock: issue out its remaining qty (auditable, not a
 *  hard delete) and disable the batch. */
export async function removeInventory(input: {
  batch: string
  itemCode: string
  reason: string
  opKey: string
}): Promise<RemoveResult> {
  const { batch, itemCode, reason, opKey } = input
  // Don't require active: remove disables the batch, so a timeout+retry must still
  // succeed (it'll find the batch disabled + empty and finish idempotently).
  await assertBatchItem(batch, itemCode, false)
  const item = await erpnextGetDoc<{ stock_uom?: string }>('Item', itemCode)
  const uom = item.stock_uom ?? 'Nos'

  const loc = await getBatchLocation(batch, itemCode)
  if (loc?.split) throw new Error(`Pallet ${batch} is split across multiple bins; consolidate in ERPNext first`)
  let stockEntry: string | null = null
  let removedQty = 0
  if (loc && loc.qty > 0) {
    removedQty = loc.qty
    stockEntry = await submitStockEntry({
      stock_entry_type: 'Material Issue',
      company: COMPANY,
      remarks: `Dashboard remove [op:${opKey}] reason: ${safeRemark(reason)}`,
      items: [
        {
          item_code: itemCode,
          qty: loc.qty,
          s_warehouse: loc.warehouse,
          use_serial_batch_fields: 1,
          batch_no: batch,
          allow_zero_valuation_rate: 1,
          uom,
          stock_uom: uom,
          conversion_factor: 1,
        },
      ],
    })
  }
  await erpnextUpdate('Batch', batch, { disabled: 1 })

  return { batch, stockEntry, removedQty }
}

export interface TransferResult extends Committed {
  fromWarehouse: string
  toWarehouse: string
  qty: number
}

const ACTIVE_SRE_STATUS_MOVE = ['Reserved', 'Partially Reserved', 'Partially Delivered']

interface MoveReservation {
  so: string
  soItem: string | null
  qty: number
  sre: string
  warehouse: string // the bin the SRE reserves in — must match where the stock actually is
  batchCount: number // distinct batches on the entry (carry requires exactly 1)
  deliveredQty: number
}

/** The pallet's active reservation, read directly and FAILING CLOSED: any lookup
 *  failure throws (unlike reservationsForBatches, which suppresses individual document
 *  reads — a reserved pallet must never read as unreserved on a move path). Throws on
 *  multiple active reservations (ambiguous). Null = genuinely unreserved. */
async function liveReservationForMove(batch: string): Promise<MoveReservation | null> {
  const qs = [
    listParam('filters', [
      ['Serial and Batch Entry', 'batch_no', '=', batch],
      ['status', 'in', ACTIVE_SRE_STATUS_MOVE],
      ['docstatus', '=', 1],
      // Sales-Order reservations ONLY: the carry releases/re-reserves through the SO
      // API and must never touch another voucher type's reservation (review r7). A
      // non-SO reservation reads as unreserved here; ERPNext then rejects the transfer
      // itself — clean failure, nothing cancelled.
      ['voucher_type', '=', 'Sales Order'],
    ]),
    listParam('fields', ['name']),
    'limit_page_length=0',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Stock Reservation Entry?${qs}`)
  const names = [...new Set((r.data ?? []).map((x) => x.name))]
  if (names.length === 0) return null
  if (names.length > 1) {
    throw new Error(
      `Pallet ${batch} has ${names.length} active reservations (${names.join(', ')}) — resolve in ERPNext before moving it`
    )
  }
  const full = await erpnextGetDoc<{
    voucher_no?: string
    voucher_detail_no?: string | null
    reserved_qty?: number
    delivered_qty?: number
    warehouse?: string
    sb_entries?: { batch_no?: string | null }[]
  }>('Stock Reservation Entry', names[0])
  const distinct = new Set(
    (full.sb_entries ?? []).map((e) => String(e.batch_no ?? '').trim()).filter(Boolean)
  )
  return {
    so: String(full.voucher_no ?? ''),
    soItem: full.voucher_detail_no ?? null,
    qty: Number(full.reserved_qty) || 0,
    sre: names[0],
    warehouse: String(full.warehouse ?? ''),
    batchCount: distinct.size,
    deliveredQty: Number(full.delivered_qty) || 0,
  }
}

/** If the pallet is reserved to a Sales Order, return that reservation — after refusing
 *  the shapes a bin move cannot carry safely: an entry that bundles several pallets
 *  (cancelling it would unreserve pallets nobody touched), one that is partially
 *  delivered (release would orphan the delivered linkage), or one whose reserved qty
 *  doesn't match the pallet's on-hand qty (re-reserving would change what the order
 *  holds). Returns null for an unreserved pallet. */
export async function reservedMoveGuard(
  batch: string,
  palletQty: number,
  palletWarehouse: string
): Promise<MoveReservation | null> {
  const res = await liveReservationForMove(batch)
  if (!res) return null
  if (res.warehouse !== palletWarehouse) {
    // Reservation points at a bin the stock is NOT in — broken state a carry must not
    // build on (review r9); fix the reservation in ERPNext first.
    throw new Error(
      `Pallet ${batch} sits in ${palletWarehouse} but its reservation to ${res.so} is bound to ${res.warehouse} — fix the reservation in ERPNext before moving it`
    )
  }
  if (res.batchCount > 1) {
    throw new Error(
      `Pallet ${batch} is reserved together with ${res.batchCount - 1} other pallet(s) in ${res.sre} — move it in ERPNext directly`
    )
  }
  if (res.deliveredQty > 0) {
    throw new Error(
      `Pallet ${batch}'s reservation to ${res.so} is partially delivered — resolve the delivery in ERPNext before moving it`
    )
  }
  if (Math.abs(res.qty - palletQty) > 1e-6) {
    throw new Error(
      `Pallet ${batch} holds ${palletQty} but ${res.qty} is reserved to ${res.so} — fix the reservation in ERPNext before moving it`
    )
  }
  if (!res.soItem) {
    // No release line on the reservation — re-reserving would auto-allocate a line,
    // which is exactly the ambiguity this feature exists to avoid (review r8). Fail
    // closed; such a reservation is handled in ERPNext directly.
    throw new Error(
      `Pallet ${batch}'s reservation to ${res.so} has no release line — move it in ERPNext directly`
    )
  }
  return res
}

/** Reservation intent stamped into the move's own Stock Entry remarks so a retry can
 *  restore the EXACT reservation this operation released — no heuristics. Server-built
 *  values only (ERPNext doc names + a number); user text never reaches this tag
 *  (safeRemark strips brackets from user input). */
interface CarriedIntent {
  so: string
  soItem: string | null
  qty: number
  sre: string // the EXACT reservation entry this op released — identity-binds recovery
}

function carriedTag(intent: CarriedIntent): string {
  return `[carried:${intent.so}|${intent.soItem ?? ''}|${intent.qty}|${intent.sre}]`
}

function parseCarriedTag(remarks: string | null | undefined): CarriedIntent | null {
  const m = /\[carried:([^|\]]+)\|([^|\]]*)\|([0-9.]+)\|([^|\]]+)\]/.exec(remarks ?? '')
  if (!m) return null
  return { so: m[1], soItem: m[2] || null, qty: Number(m[3]) || 0, sre: m[4] }
}

/** The op's own Stock Entry — submitted or DRAFT — stamped with `[op:<key>]`. The draft
 *  is created (with the carried tag) BEFORE the reservation is released, so the carry
 *  intent is durable from the first mutating step: every retry window recovers from a
 *  document this operation itself wrote. */
async function findOpStockEntry(
  opKey: string
): Promise<{ name: string; docstatus: number; remarks: string | null } | null> {
  const safe = opKey.replace(/[\\%_]/g, '\\$&')
  const qs = [
    listParam('filters', [
      ['remarks', 'like', `%[op:${safe}]%`],
      ['docstatus', 'in', [0, 1]],
    ]),
    listParam('fields', ['name', 'docstatus', 'remarks']),
    // Submitted wins over any draft; among drafts the NEWEST wins (older ones are
    // defused stale drafts or race leftovers — deterministic pick, review r5).
    `order_by=${encodeURIComponent('docstatus desc, modified desc')}`,
    'limit_page_length=1',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string; docstatus: number; remarks: string | null }[] }>(
    `/api/resource/Stock Entry?${qs}`
  )
  return r.data?.[0] ?? null
}

/** Full content validation for an op-stamped move DRAFT before it may be reused or
 *  submitted: this op's single-row Material Transfer of exactly this pallet to exactly
 *  this destination at the stamped qty. Any mismatch means the draft is stale, crafted,
 *  or was edited — it must be defused, never completed (review r6/r7). */
async function validateMoveDraft(
  name: string,
  expect: { batch: string; itemCode: string; toWarehouse: string; tagQty: number; srcWarehouse: string }
): Promise<boolean> {
  const draft = await erpnextGetDoc<{
    stock_entry_type?: string
    company?: string
    items?: {
      item_code?: string
      batch_no?: string
      qty?: number
      s_warehouse?: string
      t_warehouse?: string
      conversion_factor?: number
      use_serial_batch_fields?: number
      serial_and_batch_bundle?: string | null
    }[]
  }>('Stock Entry', name)
  const rows = draft.items ?? []
  return (
    draft.stock_entry_type === 'Material Transfer' &&
    draft.company === COMPANY &&
    rows.length === 1 &&
    // The batch source must be the FIELD, not a linked bundle — a bundle can name a
    // different batch while batch_no still reads as expected (review r13).
    Number(rows[0].use_serial_batch_fields) === 1 &&
    !rows[0].serial_and_batch_bundle &&
    rows[0].batch_no === expect.batch &&
    rows[0].item_code === expect.itemCode &&
    rows[0].s_warehouse === expect.srcWarehouse &&
    rows[0].t_warehouse === expect.toWarehouse &&
    (Number(rows[0].conversion_factor) || 1) === 1 &&
    Math.abs((Number(rows[0].qty) || 0) - expect.tagQty) <= 1e-6
  )
}

/** Take a stale stamped DRAFT permanently out of recovery's sight: rewrite its tags so
 *  the `[op:...]` LIKE never matches it again. Editing a draft's remarks is safe (it
 *  never moved stock); leaving it armed lets a later recovery resurrect the WRONG order
 *  (review r5, both legs). Best-effort — on failure the newest-draft ordering above
 *  still prefers the fresh draft. */
async function defuseStaleDraft(name: string, remarks: string | null | undefined): Promise<void> {
  try {
    const voided = (remarks ?? '').replace(/\[op:/g, '[void-op:').replace(/\[carried:/g, '[void-carried:')
    await erpnextUpdate('Stock Entry', name, { remarks: voided })
  } catch (e) {
    console.error(`move: defusing stale draft ${name} failed:`, e)
  }
}

/** After a move op reports success: make sure the pallet's reservation survived the
 *  move. Intent resolution is STRICTLY operation-bound — the `[carried:...]` tag on the
 *  op's own Stock Entry (draft or submitted); an untagged entry means the pallet was
 *  never reserved and NOTHING is restored. Returns extras for the response body —
 *  `{ reservedTo }` when the reservation is in place (or was restored here),
 *  `{ warning }` when the pallet is KNOWN to have lost its reservation and the operator
 *  must re-stage, and null when the pallet was never reserved. Never throws: stock is
 *  already committed. Concurrent restores CONVERGE without a lease: ERPNext itself caps
 *  each Stock Reservation Entry at the line's remaining unreserved qty (verified live
 *  2026-07-04, staging.ts whole-pallet notes), so of two racing restores one binds the
 *  full pallet and the other gets capped short — reserveBatchesToSO detects the
 *  shortfall, RELEASES its capped entry, and throws; the loser reports the warning
 *  while the pallet ends correctly reserved exactly once. */
export async function verifyOrRestoreMovedReservation(input: {
  batch: string
  itemCode: string
  toWarehouse: string
  opKey: string
  /** false on replays whose op row does NOT record an unresolved reservation — a replay
   *  of a long-done op must never WRITE (it could resurrect a deliberately released
   *  reservation, review r7); it may still report what it sees. */
  allowRestore: boolean
}): Promise<Record<string, unknown> | null> {
  const { batch, itemCode, toWarehouse, opKey, allowRestore } = input
  try {
    const se = await findOpStockEntry(opKey)
    const intent = se ? parseCarriedTag(se.remarks) : null
    const live = await liveReservationForMove(batch)
    if (live) {
      // Report the CURRENT binding — but never CERTIFY a carry the live state doesn't
      // actually cover: same order at a SHORT qty, on a DIFFERENT release line than
      // stamped, or bound to a bin the stock is NOT in (stale source-bin SRE) is not
      // the carry succeeding (review r5/r7/r9). A different order means the pallet was
      // re-staged mid-recovery; the truth is the live reservation.
      if (intent && live.warehouse !== toWarehouse) {
        return {
          warning: 'reservation_transfer_failed',
          reservationLostFrom: intent.so,
          reservationWrongWarehouse: live.warehouse,
        }
      }
      if (
        intent &&
        intent.so === live.so &&
        (live.qty + 1e-6 < intent.qty || live.batchCount !== 1 || live.deliveredQty > 0)
      ) {
        // Short qty, a bundled multi-pallet entry, or a partially delivered entry is
        // NOT the whole-pallet carry succeeding — never certify or clear on it (r19).
        return {
          warning: 'reservation_transfer_failed',
          reservationLostFrom: intent.so,
          partialReservedQty: live.qty,
        }
      }
      if (intent && intent.so === live.so && intent.soItem && (live.soItem ?? '') !== intent.soItem) {
        return {
          warning: 'reservation_transfer_failed',
          reservationLostFrom: intent.so,
          reservationWrongLine: true,
        }
      }
      if (intent && intent.so !== live.so) {
        // Deliberate re-stage to another order — report the live truth, but flag
        // partial coverage so the route never clears recovery state on a binding
        // that does not cover the whole pallet (r17).
        const locD = await getBatchLocation(batch, itemCode).catch(() => null)
        const partial =
          live.batchCount !== 1 ||
          live.deliveredQty > 0 ||
          (locD ? live.qty + 1e-6 < locD.qty : true)
        return {
          reservedTo: live.so,
          reservationDiffersFromCarried: intent.so,
          ...(partial ? { reservationPartial: true } : {}),
        }
      }
      if (!intent) {
        // No stamp to compare against — certify ONLY a binding that provably covers
        // the whole pallet at the DESTINATION; anything else carries the partial flag
        // so the route never clears recovery state on it (r22).
        const locN = await getBatchLocation(batch, itemCode).catch(() => null)
        const full =
          live.warehouse === toWarehouse &&
          live.batchCount === 1 &&
          live.deliveredQty === 0 &&
          !!locN &&
          live.qty + 1e-6 >= locN.qty
        return full ? { reservedTo: live.so } : { reservedTo: live.so, reservationPartial: true }
      }
      return { reservedTo: live.so }
    }
    if (!intent) return null // untagged/absent SE = this op never carried a reservation
    const loc = await getBatchLocation(batch, itemCode)
    // Restore exactly the STAMPED qty on the STAMPED line — and only when the pallet
    // still holds it at the destination; anything else is a loud warning, never a
    // guessed partial or auto-allocated restore (r5/r8).
    if (!loc || loc.warehouse !== toWarehouse || Math.abs(loc.qty - intent.qty) > 1e-6 || !intent.soItem) {
      return { warning: 'reservation_transfer_failed', reservationLostFrom: intent.so }
    }
    if (!allowRestore) {
      return { warning: 'reservation_transfer_failed', reservationLostFrom: intent.so }
    }
    // The remark tag alone must never mint a reservation — require the cancelled-SRE
    // corroboration before writing (review r11). Refuted = forged/never carried (null);
    // unknown = transient — report loudly, restore on a later attempt (r13).
    const cv = await corroborateCarriedIntent(batch, intent)
    if (cv === 'refuted') return null
    if (cv === 'unknown') {
      return { warning: 'reservation_transfer_failed', reservationLostFrom: intent.so }
    }
    await reserveBatchesToSO({
      soName: intent.so,
      items: [
        { salesOrderItem: intent.soItem, itemCode, warehouse: toWarehouse, batch, qty: intent.qty },
      ],
    })
    return { reservedTo: intent.so, reservationRestored: true }
  } catch (e) {
    console.error(`move: reservation follow for ${batch} failed:`, e)
    return { warning: 'reservation_transfer_failed' }
  }
}

/** Move a pallet between bins: a Material Transfer of the batch's full on-hand qty
 *  from its current warehouse to `toWarehouse`. Refuses split pallets (can't guess
 *  which bin to move) and no-op moves. */
/** Deterministic, READ-ONLY validation for a move: batch belongs to the item + active,
 *  destination bin is valid, pallet has stock and isn't split. Throws on any violation.
 *  Call this in the route BEFORE the op-log row is inserted so a deterministic failure is
 *  a clean 400 — not a post-insert throw that would lock the family in failed_pre_erp. */
export async function transferPreflight(
  batch: string,
  itemCode: string,
  toWarehouse: string
): Promise<{ reserved: boolean; so: string | null }> {
  await assertBatchItem(batch, itemCode)
  await preflight(itemCode, toWarehouse) // destination bin: exists, not a group, enabled, right company
  const loc = await getBatchLocation(batch, itemCode)
  if (!loc || loc.qty <= 0) throw new Error(`Pallet ${batch} has no stock to move`)
  if (loc.split) throw new Error(`Pallet ${batch} is split across multiple bins; consolidate in ERPNext first`)
  // Reserved pallets ARE movable (the reservation is carried across the move) — but only
  // the shapes reservedMoveGuard accepts; anything else 400s here with a clear message
  // instead of failing inside the locked op. Whether the pallet is reserved is returned
  // so the route can arm the reservation checkpoint AT OP-ROW BIRTH (r11): the durable
  // 'reservation:' marker then exists before any mutating step, closing the crash gap
  // between the runner's terminal write and a post-hoc checkpoint.
  const guarded = await reservedMoveGuard(batch, loc.qty, loc.warehouse)
  return { reserved: guarded !== null, so: guarded?.so ?? null }
}

/** The Sales Order a move of this pallet would touch — for the route's so: lease.
 *  Reads the live reservation first, falling back to the op's own stamped draft (a
 *  retry mid-carry has already released the reservation). Best-effort: null means no
 *  so: lease, and the pallet: lease still serializes the pallet itself. */
export async function moveLeaseSo(batch: string, opKey: string): Promise<string | null> {
  // FAIL CLOSED (r18): a lookup failure THROWS — proceeding without the so: lease
  // while later ERP reads succeed would mutate reservation capacity unserialized.
  const live = await liveReservationForMove(batch)
  if (live) return live.so
  const se = await findOpStockEntry(opKey)
  return se ? (parseCarriedTag(se.remarks)?.so ?? null) : null
}

/** Independent corroboration that a `[carried:...]` tag describes the reservation this
 *  op really released: the tag names the EXACT Stock Reservation Entry, and that
 *  document must exist CANCELLED with precisely the stamped SO, line, qty, and this
 *  single batch. Remarks are editable ERP-side; the cancelled document trail is not —
 *  a tag that doesn't match its named record is treated as forged/invalid and never
 *  restored (review r11/r12: identity-bound, not shape-matched against history). */
async function corroborateCarriedIntent(
  batch: string,
  intent: CarriedIntent
): Promise<'confirmed' | 'refuted' | 'unknown'> {
  if (!intent.soItem || !intent.sre) return 'refuted'
  let doc: {
    docstatus?: number
    voucher_type?: string
    voucher_no?: string
    voucher_detail_no?: string | null
    reserved_qty?: number
    creation?: string
    sb_entries?: { batch_no?: string | null }[]
  }
  try {
    doc = await erpnextGetDoc('Stock Reservation Entry', intent.sre)
  } catch (e) {
    // Only a MISSING document refutes the tag (forged/invalid name). A transient
    // lookup failure must NEVER read as refuted — that fail-open turned a brief ERP
    // outage into defused recovery artifacts and silent SO-coverage loss (r13).
    return / -> 404/.test((e as Error).message) ? 'refuted' : 'unknown'
  }
  const batches = new Set(
    (doc.sb_entries ?? []).map((e) => String(e.batch_no ?? '').trim()).filter(Boolean)
  )
  const ok =
    doc.docstatus === 2 &&
    doc.voucher_type === 'Sales Order' &&
    doc.voucher_no === intent.so &&
    (doc.voucher_detail_no ?? null) === intent.soItem &&
    Math.abs((Number(doc.reserved_qty) || 0) - intent.qty) <= 1e-6 &&
    batches.size === 1 &&
    batches.has(batch)
  if (!ok) return 'refuted'
  // SUPERSESSION (r17): the stamp only authorizes a restore while it is the pallet's
  // LATEST reservation event. Any newer reservation (active or since-cancelled) means
  // an operator re-bound the pallet after this carry — restoring the old order would
  // resurrect a superseded state.
  const doc2 = doc as { creation?: string }
  if (doc2.creation) {
    try {
      const qs = [
        listParam('filters', [
          ['Serial and Batch Entry', 'batch_no', '=', batch],
          ['voucher_type', '=', 'Sales Order'],
          ['creation', '>', doc2.creation],
          ['name', '!=', intent.sre],
        ]),
        listParam('fields', ['name', 'docstatus', 'status', 'reserved_qty']),
        'limit_page_length=0',
      ].join('&')
      const newer = await erpnextGet<{
        data: { name: string; docstatus: number; status: string; reserved_qty: number }[]
      }>(`/api/resource/Stock Reservation Entry?${qs}`)
      // Only a REAL later binding supersedes: an active entry, or a cancelled one at
      // (at least) the stamped whole-pallet qty. A capped-SHORT cancelled entry is
      // this flow's own aborted restore (reserveBatchesToSO releases on shortfall) —
      // counting it poisoned the op's own replay into a clean-200 loss (r18).
      const superseded = (newer.data ?? []).some(
        (n) =>
          (n.docstatus === 1 && ACTIVE_SRE_STATUS_MOVE.includes(n.status)) ||
          (n.docstatus === 2 && (Number(n.reserved_qty) || 0) + 1e-6 >= intent.qty)
      )
      if (superseded) return 'refuted'
    } catch {
      return 'unknown' // fail closed: cannot prove latest — do not restore now
    }
  }
  return 'confirmed'
}

export async function transferInventory(input: {
  batch: string
  itemCode: string
  toWarehouse: string
  opKey: string
  /** The Sales Order the route's so: lease covers (null = no so: lease held). erp()
   *  refuses to carry a reservation on a DIFFERENT order — the lease snapshot would be
   *  stale and that order's capacity unserialized (review r19); the retry re-resolves. */
  leasedSo?: string | null
  /** Server-side restore authority (the ops-log 'reservation:' marker) — the at-
   *  destination no-op verify must honor the SAME gate as the route (review r22). */
  restoreAuthorized?: boolean
  /** Called the moment a live reservation is confirmed for carrying, BEFORE any
   *  mutating step — the route uses it to arm the durable 'reservation:' checkpoint
   *  even when the reservation appeared after preflight (review r14). Best-effort. */
  onCarryStart?: () => Promise<void>
}): Promise<TransferResult> {
  const { batch, itemCode, toWarehouse, opKey, leasedSo, restoreAuthorized, onCarryStart } = input
  await assertBatchItem(batch, itemCode)
  // Validate the destination bin (exists, not a group, enabled, right company).
  const item = await preflight(itemCode, toWarehouse)
  const uom = item.uom

  const loc = await getBatchLocation(batch, itemCode)
  if (!loc || loc.qty <= 0) throw new Error(`Pallet ${batch} has no stock to move`)
  if (loc.split) throw new Error(`Pallet ${batch} is split across multiple bins; consolidate in ERPNext first`)
  // Already at the destination: treat as a no-op success so a timeout+retry of a
  // move that already committed resolves cleanly instead of erroring — but first make
  // sure the committed move didn't strand the reservation (crash between release and
  // re-reserve on the original attempt). Intent comes from the op's own stamped Stock
  // Entry, so the check is bound to THIS operation.
  if (loc.warehouse === toWarehouse) {
    const follow = await verifyOrRestoreMovedReservation({
      batch,
      itemCode,
      toWarehouse,
      opKey,
      // NOT unconditional (r22): a fresh clean op that happens to target the current
      // bin must never gain restore authority a forged draft could exploit.
      allowRestore: restoreAuthorized === true,
    })
    const se = await findOpStockEntry(opKey).catch(() => null)
    return {
      batch,
      stockEntry: se && se.docstatus === 1 ? se.name : null,
      fromWarehouse: loc.warehouse,
      toWarehouse,
      qty: loc.qty,
      ...(follow ? { extra: follow } : {}),
    }
  }

  // Reserved pallet: ERPNext refuses to transfer a reserved batch, so carry the
  // reservation across the move (Simon 2026-07-21: "we do need to transfer reserved
  // stock"). Order of operations makes every window recoverable WITHOUT heuristics:
  //   1. create the transfer as a DRAFT stamped [op:key] [carried:so|line|qty]
  //   2. release the reservation (pinned to the confirmed SRE)
  //   3. submit the draft
  //   4. re-reserve in the destination bin on the SAME release line
  // The durable carried tag exists from step 1, BEFORE anything is released — a retry
  // resuming after any crash finds this op's own document and restores exactly that
  // intent. A pre-commit failure restores the source-bin reservation and fails the op;
  // a post-commit failure NEVER throws (the ops-log row must record the committed
  // stock entry) — it returns warning extras the route surfaces.
  const live = await reservedMoveGuard(batch, loc.qty, loc.warehouse)
  if (live && leasedSo !== undefined && live.so !== leasedSo) {
    // The reservation appeared or changed AFTER the route chose its leases — its order
    // is not serialized by this request. Refuse retryably; the retry leases the
    // current order (r19).
    throw new Error(
      `Pallet ${batch}'s reservation changed while the move was starting — try again`
    )
  }
  if (live && onCarryStart) {
    // Propagates: a checkpoint that cannot be armed aborts the carry BEFORE any
    // mutation (fail closed, r20).
    await onCarryStart()
  }
  // This op's own prior document (retry): a submitted entry can't coexist with stock
  // still at the source; a DRAFT means the first attempt died mid-carry — resume it.
  const prior = await findOpStockEntry(opKey)
  let priorDraft = prior && prior.docstatus === 0 ? prior : null
  // A stamped draft may only RESUME a carry when the server-side checkpoint authorizes
  // it (r23): without the marker, a crafted pre-created draft on a fresh unreserved op
  // would otherwise resurrect a cancelled reservation. Unauthorized drafts are ignored
  // (not defused — an admin can inspect them; they can never act without the marker).
  if (!live && priorDraft && restoreAuthorized !== true) {
    priorDraft = null
  }
  // A stale draft whose stamped intent no longer matches the LIVE reservation (the
  // pallet was released and re-staged to another order between attempts) must not be
  // reused — its tag would later "restore" the wrong order. DEFUSE it (strip its op
  // tags so no recovery path can ever pick it up) and create a fresh stamped draft.
  if (live && priorDraft) {
    const priorTag = parseCarriedTag(priorDraft.remarks)
    if (
      !priorTag ||
      priorTag.so !== live.so ||
      (priorTag.soItem ?? '') !== (live.soItem ?? '') ||
      // SRE identity too: a source-bin restore after a failed submit mints a NEW SRE;
      // reusing the old-SRE draft would then refuse pre-submit validation forever
      // (retry livelock, r13). A fresh draft stamped with the live SRE resolves it.
      priorTag.sre !== live.sre ||
      // Qty drift (pallet adjusted between attempts): submitting the old draft would
      // SPLIT the pallet across bins while re-reserving the new qty (review r10).
      Math.abs(priorTag.qty - live.qty) > 1e-6
    ) {
      await defuseStaleDraft(priorDraft.name, priorDraft.remarks)
      priorDraft = null
    }
  }
  // Any reused draft must also pass full CONTENT validation — same bar as the
  // resume path; a stale or edited draft is defused and replaced (review r7). When the
  // defused draft carried a CORROBORATED intent and the reservation is already gone,
  // that loss must surface loudly — a defuse must never convert a known loss into a
  // clean success (review r11).
  let resumeIntent: CarriedIntent | null = null
  let deferredDefuse: { name: string; remarks: string | null } | null = null
  if (priorDraft) {
    const priorTag = parseCarriedTag(priorDraft.remarks)
    const ok =
      priorTag &&
      (await validateMoveDraft(priorDraft.name, { batch, itemCode, toWarehouse, tagQty: priorTag.qty, srcWarehouse: loc.warehouse }))
    if (!ok) {
      // ORDERING (r16): the armed draft is the ONLY durable recovery artifact — it is
      // defused only once its fate is decided: refuted/live-superseded → defuse now;
      // corroboration unknown → abort with it ARMED; confirmed → defuse DEFERRED until
      // the fresh replacement draft exists (newest-wins lookup covers the overlap).
      if (!live && priorTag) {
        const cv = await corroborateCarriedIntent(batch, priorTag)
        if (cv === 'unknown') {
          throw new Error(
            `Cannot verify pallet ${batch}'s interrupted reservation carry right now — try again shortly`
          )
        }
        if (cv === 'confirmed') {
          resumeIntent = priorTag
          deferredDefuse = { name: priorDraft.name, remarks: priorDraft.remarks }
        }
      }
      if (!deferredDefuse) await defuseStaleDraft(priorDraft.name, priorDraft.remarks)
      priorDraft = null
    }
  }

  // Intent is derived only AFTER every draft-vetting step above (a defused draft must
  // never contribute intent — review r10). A no-live intent must be CORROBORATED by
  // the cancelled-reservation record — the remark tag alone is editable ERP-side and
  // must never mint a reservation by itself (review r11).
  let intent: CarriedIntent | null = live
    ? { so: live.so, soItem: live.soItem, qty: live.qty, sre: live.sre }
    : (priorDraft ? parseCarriedTag(priorDraft.remarks) : null) ?? resumeIntent
  if (!live && intent && leasedSo !== undefined && intent.so !== leasedSo) {
    // The so: lease this request holds does not cover the stamped order — refuse
    // retryably; the retry resolves its lease from the draft (r23).
    throw new Error(
      `Pallet ${batch}'s interrupted carry targets a different order than this request locked — try again`
    )
  }
  if (!live && intent) {
    const cv = await corroborateCarriedIntent(batch, intent)
    if (cv === 'refuted') {
      if (priorDraft) await defuseStaleDraft(priorDraft.name, priorDraft.remarks)
      priorDraft = null
      intent = null // forged/invalid tag = nothing real was released; move clean
    } else if (cv === 'unknown') {
      // Transient — the interrupted carry cannot be verified right now. Abort with the
      // draft ARMED; the retry resumes when ERP answers (fail closed, r13).
      throw new Error(
        `Cannot verify pallet ${batch}'s interrupted reservation carry right now — try again shortly`
      )
    }
  }
  // Resume without a live reservation: the pallet's on-hand must still match the
  // stamped qty, or completing the draft would SPLIT the pallet across bins. Should be
  // unreachable (serialized pallets change qty only via reissue) — on mismatch FAIL
  // the op with everything ARMED: an ephemeral warning on an untagged entry was
  // silently droppable on replay (r16). The operator re-stages, which supersedes the
  // stale draft via the SRE-identity check on the next move.
  if (!live && intent && Math.abs(loc.qty - intent.qty) > 1e-6) {
    throw new Error(
      `Pallet ${batch}'s quantity changed while its move was interrupted (${intent.qty} reserved vs ${loc.qty} on hand) — re-stage the pallet to ${intent.so}, then move it again`
    )
  }

  const seDoc = {
    stock_entry_type: 'Material Transfer',
    company: COMPANY,
    // The [carried:...] stamp makes the released reservation recoverable from this
    // document itself — a retry restores exactly this intent, never a guess.
    remarks: `Dashboard move [op:${opKey}]${intent ? ` ${carriedTag(intent)}` : ''}`,
    items: [
      {
        item_code: itemCode,
        qty: loc.qty,
        s_warehouse: loc.warehouse,
        t_warehouse: toWarehouse,
        use_serial_batch_fields: 1,
        batch_no: batch,
        allow_zero_valuation_rate: 1,
        uom,
        stock_uom: uom,
        conversion_factor: 1,
      },
    ],
  }

  // Step 1 — durable intent before any mutation of the reservation. (A prior stale
  // draft was discarded above; only a tag-matching draft is reused.)
  let draftName: string | null = priorDraft?.name ?? null
  if (intent && !draftName) {
    draftName = (await erpnextCreate<{ name: string }>('Stock Entry', seDoc)).name
  }
  if (deferredDefuse && draftName) {
    // The replacement exists — NOW retire the superseded draft (r16 ordering).
    await defuseStaleDraft(deferredDefuse.name, deferredDefuse.remarks)
  }

  // Step 2 — release (only when a live reservation exists).
  if (live) {
    let released: boolean
    try {
      released = (await releaseBatchReservation(batch, live.sre)).released
    } catch (e) {
      // The helper cancels the SRE first, then recomputes SO staging metadata — a
      // failure AFTER the cancel must not fail the move (the reservation is already
      // gone; the intent is stamped in the draft). Only a failure that left the
      // reservation intact is safe to propagate. That check fails CLOSED: if it can't
      // be read, assume intact and propagate (the stamped draft is inert and reused on
      // retry).
      const still = await liveReservationForMove(batch).catch(() => ({ sre: 'unverifiable' }))
      if (still) throw e
      console.error(`move: release bookkeeping for ${batch} failed post-cancel (continuing):`, e)
      released = true // the cancel itself committed
    }
    if (!released) {
      // The reservation vanished between the snapshot and the cancel (someone released
      // it concurrently) — the carry's premise changed. Defuse the stamped draft and
      // abort; the operator re-initiates against the current state (review r8).
      if (draftName) await defuseStaleDraft(draftName, String(seDoc.remarks))
      throw new Error(
        `Pallet ${batch}'s reservation changed while the move was starting — re-check the pallet and try again`
      )
    }
  }

  // Step 3 — commit the transfer (submit the stamped draft; unreserved moves submit
  // directly).
  let stockEntry: string | null
  try {
    if (draftName) {
      // Revalidate the EXACT fetched document before submitting it — the window after
      // the release is where an ERP-side edit could retarget the transfer, and the
      // service account must never submit a document it hasn't just verified (r11).
      const fresh = await erpnextGetDoc<{
        stock_entry_type?: string
        company?: string
        remarks?: string | null
        items?: {
          item_code?: string
          batch_no?: string
          qty?: number
          s_warehouse?: string
          t_warehouse?: string
          conversion_factor?: number
          use_serial_batch_fields?: number
          serial_and_batch_bundle?: string | null
        }[]
      }>('Stock Entry', draftName)
      const fr = fresh.items ?? []
      const freshTag = parseCarriedTag(fresh.remarks)
      if (
        fresh.stock_entry_type !== 'Material Transfer' ||
        fresh.company !== COMPANY ||
        !(fresh.remarks ?? '').includes(`[op:${opKey}]`) ||
        // The recovery intent must ride the submitted document unaltered: an edit that
        // erased or retargeted the carried tag in the release window must refuse (r12).
        (intent
          ? !freshTag ||
            freshTag.so !== intent.so ||
            (freshTag.soItem ?? '') !== (intent.soItem ?? '') ||
            freshTag.sre !== intent.sre ||
            Math.abs(freshTag.qty - intent.qty) > 1e-6
          : freshTag !== null) ||
        fr.length !== 1 ||
        Number(fr[0].use_serial_batch_fields) !== 1 ||
        !!fr[0].serial_and_batch_bundle ||
        fr[0].batch_no !== batch ||
        fr[0].item_code !== itemCode ||
        fr[0].s_warehouse !== loc.warehouse ||
        fr[0].t_warehouse !== toWarehouse ||
        (Number(fr[0].conversion_factor) || 1) !== 1 ||
        Math.abs((Number(fr[0].qty) || 0) - loc.qty) > 1e-6
      ) {
        throw new Error(`Draft ${draftName} changed since validation — refusing to submit it`)
      }
      const submitted = await erpnextSubmit<{ name?: string }>(fresh)
      stockEntry = submitted.name ?? draftName
    } else {
      stockEntry = await submitStockEntry(seDoc)
    }
  } catch (e) {
    // A submit timeout can land AFTER ERPNext committed — verify before compensating,
    // or the "restore" would re-reserve in a bin the stock just left (review r3). The
    // compensation must FAIL CLOSED (r14): it runs only when the stock is VERIFIABLY
    // still at the source; if either the stamped-entry check or the location read
    // fails, restore nothing and rethrow — the armed draft + born checkpoint make the
    // retry resume the carry safely.
    const committedSe = await findOpStockEntry(opKey).catch(() => null)
    const committedValid =
      committedSe &&
      committedSe.docstatus === 1 &&
      (await validateMoveDraft(committedSe.name, {
        batch,
        itemCode,
        toWarehouse,
        tagQty: loc.qty,
        srcWarehouse: loc.warehouse,
      }).catch(() => false))
    if (committedSe && committedSe.docstatus === 1 && committedValid) {
      stockEntry = committedSe.name
    } else {
      if (intent) {
        const locNow = await getBatchLocation(batch, itemCode).catch(() => null)
        const verifiablyAtSource =
          !!locNow && locNow.warehouse === loc.warehouse && Math.abs(locNow.qty - loc.qty) <= 1e-6
        if (verifiablyAtSource) {
          // Stock never moved — put the reservation back in the SOURCE bin so the
          // pallet stays locked to its order while the operator retries.
          try {
            await reserveBatchesToSO({
              soName: intent.so,
              items: [
                { salesOrderItem: intent.soItem ?? undefined, itemCode, warehouse: loc.warehouse, batch, qty: loc.qty },
              ],
            })
          } catch (restoreErr) {
            console.error(`move: source-bin reservation restore for ${batch} failed:`, restoreErr)
            throw new Error(
              `Move of ${batch} failed and its reservation to ${intent.so} could not be put back — retry the move (it resumes automatically), or re-stage from the staging screen. Move error: ${(e as Error).message}`
            )
          }
        } else {
          console.error(
            `move: submit outcome for ${batch} unverifiable — skipping source-bin restore (fail closed)`
          )
        }
      }
      throw e
    }
  }

  if (!intent) {
    return {
      batch,
      stockEntry,
      fromWarehouse: loc.warehouse,
      toWarehouse,
      qty: loc.qty,
    }
  }

  // Step 4 — re-reserve in the destination bin.
  try {
    await reserveBatchesToSO({
      soName: intent.so,
      items: [
        { salesOrderItem: intent.soItem ?? undefined, itemCode, warehouse: toWarehouse, batch, qty: loc.qty },
      ],
    })
  } catch (e) {
    // Stock is committed — do NOT throw (the ops log must not record failed_pre_erp).
    // Loud warning instead; retry/reconcile restores from the stamped entry.
    console.error(`move: dest-bin re-reserve for ${batch} -> ${intent.so} failed:`, e)
    return {
      batch,
      stockEntry,
      fromWarehouse: loc.warehouse,
      toWarehouse,
      qty: loc.qty,
      extra: { warning: 'reservation_transfer_failed', reservationLostFrom: intent.so },
    }
  }

  return {
    batch,
    stockEntry,
    fromWarehouse: loc.warehouse,
    toWarehouse,
    qty: loc.qty,
    extra: { reservedTo: intent.so },
  }
}

// ─── Bulk bin transfer (scan-to-queue) ───────────────────────────────────────────
export interface PalletLookup {
  batch: string // the CURRENT serial (a scanned old label maps forward)
  itemCode: string
  itemName: string
  warehouse: string // current/source bin
  qty: number
  split: boolean
  superseded: boolean // the scanned code was an older serial
  scanned: string
}

/** Resolve a scanned/typed pallet code to a transfer-queue line: current serial, item,
 *  source bin, and on-hand qty. Returns null if the code isn't a stocked pallet. */
export async function lookupPallet(code: string): Promise<PalletLookup | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const { current, superseded } = await resolveCurrentSerial(trimmed)
  const batch = current ?? trimmed
  const b = await erpnextGetDoc<{ item?: string }>('Batch', batch).catch(() => null)
  if (!b?.item) return null
  const itemCode = b.item
  const loc = await getBatchLocation(batch, itemCode)
  if (!loc || loc.qty <= 0) return null
  const item = await erpnextGetDoc<{ item_name?: string }>('Item', itemCode).catch(() => null)
  return {
    batch,
    itemCode,
    itemName: item?.item_name ?? itemCode,
    warehouse: loc.warehouse,
    qty: loc.qty,
    split: loc.split,
    superseded,
    scanned: trimmed,
  }
}

/** Move many pallets to one destination bin in a SINGLE ERPNext Material Transfer (one
 *  document, one submit, atomic). Each pallet moves its full on-hand qty from its own
 *  current bin. Pallets with no stock, split across bins, or already at the destination
 *  are skipped (reported back), not failed. Moves don't change qty, so no reissue/relabel.
 *  Idempotent via runInventoryOp + the [op:key] stamp (reconcileStockEntry). */
export async function bulkTransfer(input: {
  destination: string
  lines: { batch: string; itemCode: string }[]
  opKey: string
}): Promise<Committed> {
  const { destination, lines, opKey } = input
  const seen = new Set<string>()
  const uniq = lines.filter((l) => l.batch && l.itemCode && !seen.has(l.batch) && (seen.add(l.batch), true))
  if (uniq.length === 0) return { stockEntry: null, extra: { moved: 0, skipped: [], destination } }

  // Validate the destination bin once (exists, not a group, enabled, right company).
  await preflight(uniq[0].itemCode, destination)
  const meta = await itemNameMap([...new Set(uniq.map((l) => l.itemCode))])

  // Reserved pallets are SKIPPED here, not failed: one reserved batch would reject the
  // whole (single, atomic) Stock Entry. Moving a reserved pallet carries its reservation
  // and is a per-pallet operation — use the single-pallet move for those. A failed
  // LIST lookup fails the bulk (throw). NOTE: reservationsForBatches suppresses
  // individual SRE document reads, so a reserved pallet with an unreadable SRE can slip
  // past this skip — ERPNext then rejects the whole atomic Stock Entry with its
  // reserved-batch error (loud failure, no partial move, no corruption).
  const reservedMap = await reservationsForBatches(uniq.map((l) => l.batch))

  const rows: Record<string, unknown>[] = []
  const skipped: { batch: string; reason: string }[] = []
  for (const l of uniq) {
    if (reservedMap[l.batch]) {
      skipped.push({ batch: l.batch, reason: 'reserved' })
      continue
    }
    const loc = await getBatchLocation(l.batch, l.itemCode)
    if (!loc || loc.qty <= 0) {
      skipped.push({ batch: l.batch, reason: 'no-stock' })
      continue
    }
    if (loc.split) {
      skipped.push({ batch: l.batch, reason: 'split' })
      continue
    }
    if (loc.warehouse === destination) {
      skipped.push({ batch: l.batch, reason: 'already-here' })
      continue
    }
    const uom = meta.get(l.itemCode)?.uom ?? 'Nos'
    rows.push({
      item_code: l.itemCode,
      qty: loc.qty,
      s_warehouse: loc.warehouse,
      t_warehouse: destination,
      use_serial_batch_fields: 1,
      batch_no: l.batch,
      allow_zero_valuation_rate: 1,
      uom,
      stock_uom: uom,
      conversion_factor: 1,
    })
  }
  if (rows.length === 0) return { stockEntry: null, extra: { moved: 0, skipped, destination } }

  const stockEntry = await submitStockEntry({
    stock_entry_type: 'Material Transfer',
    company: COMPANY,
    remarks: `Dashboard bulk transfer [op:${opKey}] -> ${destination} (${rows.length})`,
    items: rows,
  })
  return { stockEntry, extra: { moved: rows.length, skipped, destination } }
}

// ─── Non-serialized (quantity-only) items ─────────────────────────────────────────
// Some product lines are fixed, interchangeable packs (e.g. CURB-36PK, EB-48PK): every
// box is identical, so we DON'T serialize them. In ERPNext these items have
// has_batch_no = 0 and stock is tracked as a plain quantity per bin. The dashboard works
// in BOXES (one stock unit = one box/pack); a generic label (no unique pallet code) is
// printed one-per-box. Transfers/removals move a quantity between bins with no batch.

/** Read an item's display + tracking info. `hasBatch` decides serialized (pallet) vs
 *  quantity (non-serialized) handling everywhere. `piecesPerPack` is the quantity PRINTED on
 *  one generic label = the ERPNext custom field `custom_pieces_per_pack` when set, else 1.
 *  Default 1 because a pack is itself one assembly (e.g. a "48 pack" is 1 unit of inventory —
 *  the SKU name already conveys the 48; printing 48 would mislead the floor about the count).
 *  Products where one box really holds N loose pieces (e.g. the 500s) set the field to N. */
export async function getItemInfo(
  itemCode: string
): Promise<{ itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number; itemGroup: string }> {
  const item = await erpnextGetDoc<{
    item_name?: string
    stock_uom?: string
    has_batch_no?: number
    is_stock_item?: number
    custom_pieces_per_pack?: number
    item_group?: string
  }>('Item', itemCode)
  if (!item.is_stock_item) throw new Error(`Item ${itemCode} is not a stock item`)
  const fieldPack = Number(item.custom_pieces_per_pack)
  return {
    itemName: item.item_name ?? itemCode,
    uom: item.stock_uom ?? 'pcs',
    hasBatch: !!item.has_batch_no,
    itemGroup: item.item_group ?? '',
    piecesPerPack: fieldPack > 0 ? fieldPack : 1,
  }
}

/** Guard: the item must be NON-batch (quantity-tracked). Throws -> failed_pre_erp / 400, so
 *  a quantity op can never run against a serialized (pallet) item by mistake. */
async function assertNonBatch(itemCode: string): Promise<{ itemName: string; uom: string }> {
  const info = await getItemInfo(itemCode)
  if (info.hasBatch) throw new Error(`Item ${itemCode} is serialized (batch-tracked); use the pallet flow, not quantity mode`)
  return { itemName: info.itemName, uom: info.uom }
}

/** Bins (with stock) for a single item: warehouse + qty, highest first. Read-only. */
export async function getItemBins(itemCode: string): Promise<{ warehouse: string; qty: number }[]> {
  const qs = [
    listParam('filters', [
      ['item_code', '=', itemCode],
      ['actual_qty', '>', 0],
    ]),
    listParam('fields', ['warehouse', 'actual_qty']),
    'limit_page_length=0',
  ].join('&')
  const rows = (await erpnextGet<{ data: { warehouse: string; actual_qty: number }[] }>(`/api/resource/Bin?${qs}`)).data ?? []
  return rows.map((r) => ({ warehouse: r.warehouse, qty: r.actual_qty })).sort((a, b) => b.qty - a.qty)
}

export interface SalesOrderOption {
  name: string
  customer: string
  status: string
  deliveryDate: string | null
}

/** Open Sales Orders that include `itemCode` as a line — so a label can be attached to the
 *  RIGHT order without scrolling past every SO. ONE query on Sales Order with a child-table
 *  filter (`["Sales Order Item","item_code","=",code]`); querying the child doctype directly
 *  trips Frappe's parent-permission check. Submitted + still-open only (excludes Completed /
 *  Closed / Cancelled; Draft is excluded by docstatus=1). Read-only. */
export async function listSalesOrdersForItem(itemCode: string): Promise<SalesOrderOption[]> {
  const qs = [
    listParam('filters', [
      ['Sales Order Item', 'item_code', '=', itemCode],
      ['docstatus', '=', 1],
      ['status', 'not in', ['Completed', 'Closed', 'Cancelled']],
    ]),
    listParam('fields', ['name', 'customer', 'status', 'delivery_date']),
    // Bound the result like every other ERPNext query here — open SOs for one part is a
    // small set, but never let it run unbounded.
    'limit_page_length=200',
  ].join('&')
  const rows =
    (await erpnextGet<{ data: { name: string; customer: string; status: string; delivery_date: string | null }[] }>(`/api/resource/Sales Order?${qs}`)).data ?? []
  // A child-table filter can return the parent once per matching child row — de-dupe by name.
  const byName = new Map<string, SalesOrderOption>()
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, { name: r.name, customer: r.customer, status: r.status, deliveryDate: r.delivery_date ?? null })
  }

  // Drop orders that can't take any more of THIS item (fully shipped and/or
  // fully reserved — a "To Bill" order whose stock all left still passed the
  // status filter and offered itself for new labels; Simon caught SO-00076
  // doing exactly that, 2026-07-03). Per line: what's left to stage is
  // ordered − max(delivered, reserved) — reserved stays populated even after
  // delivery, and delivered covers shipped-without-reservation. A partially
  // shipped multi-release order keeps its open lines and stays listed.
  const open: SalesOrderOption[] = []
  await Promise.all(
    [...byName.values()].map(async (opt) => {
      try {
        const doc = await erpnextGetDoc<{
          items?: { item_code: string; qty: number; stock_qty?: number | null; delivered_qty?: number | null; stock_reserved_qty?: number | null; reserve_stock?: number | null }[]
        }>('Sales Order', opt.name)
        const remaining = (doc.items ?? [])
          .filter((l) => l.item_code === itemCode)
          .reduce((s, l) => {
            const ordered = Number(l.stock_qty ?? l.qty) || 0
            const used = Math.max(Number(l.delivered_qty) || 0, Number(l.stock_reserved_qty) || 0)
            return s + Math.max(0, ordered - used)
          }, 0)
        if (remaining > 1e-6) open.push(opt)
      } catch {
        open.push(opt) // fail open for the DISPLAY list; reservation guards enforce
      }
    })
  )
  // Soonest delivery first; undated last.
  return open.sort((a, b) => (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999') || a.name.localeCompare(b.name))
}

export interface QtyResult extends Committed {
  itemName: string
  uom: string
  qty: number
  warehouse: string
}

/** Receive a quantity of a non-serialized item into a bin (Material Receipt, no batch). */
export async function qtyReceive(input: { itemCode: string; qty: number; warehouse: string; opKey: string }): Promise<QtyResult> {
  const { itemCode, qty, warehouse, opKey } = input
  if (!(qty > 0)) throw new Error('Receive qty must be greater than 0')
  const { itemName, uom } = await assertNonBatch(itemCode)
  await preflightWarehouse(warehouse)
  const existing = await reconcileStockEntry(opKey)
  const stockEntry =
    existing ??
    (await submitStockEntry({
      stock_entry_type: 'Material Receipt',
      company: COMPANY,
      remarks: `Dashboard qty-receive [op:${opKey}]`,
      items: [{ item_code: itemCode, qty, t_warehouse: warehouse, allow_zero_valuation_rate: 1, uom, stock_uom: uom, conversion_factor: 1 }],
    }))
  return { stockEntry, itemName, uom, qty, warehouse }
}

/** Move a quantity of a non-serialized item from one bin to another (Material Transfer). */
export async function qtyTransfer(input: {
  itemCode: string
  qty: number
  fromWarehouse: string
  toWarehouse: string
  opKey: string
}): Promise<QtyResult> {
  const { itemCode, qty, fromWarehouse, toWarehouse, opKey } = input
  if (!(qty > 0)) throw new Error('Transfer qty must be greater than 0')
  if (fromWarehouse === toWarehouse) throw new Error('Source and destination bins are the same')
  const { itemName, uom } = await assertNonBatch(itemCode)
  await preflightWarehouse(fromWarehouse)
  await preflightWarehouse(toWarehouse)
  const existing = await reconcileStockEntry(opKey)
  const stockEntry =
    existing ??
    (await submitStockEntry({
      stock_entry_type: 'Material Transfer',
      company: COMPANY,
      remarks: `Dashboard qty-transfer [op:${opKey}] ${fromWarehouse} -> ${toWarehouse}`,
      items: [
        { item_code: itemCode, qty, s_warehouse: fromWarehouse, t_warehouse: toWarehouse, allow_zero_valuation_rate: 1, uom, stock_uom: uom, conversion_factor: 1 },
      ],
    }))
  return { stockEntry, itemName, uom, qty, warehouse: toWarehouse }
}

/** Issue a quantity of a non-serialized item out of a bin (Material Issue) — for damage /
 *  internal use. Order-based shipping stays in ERPNext (Sales Order fulfillment). */
export async function qtyRemove(input: { itemCode: string; qty: number; warehouse: string; reason: string; opKey: string }): Promise<QtyResult> {
  const { itemCode, qty, warehouse, reason, opKey } = input
  if (!(qty > 0)) throw new Error('Remove qty must be greater than 0')
  const { itemName, uom } = await assertNonBatch(itemCode)
  const existing = await reconcileStockEntry(opKey)
  const stockEntry =
    existing ??
    (await submitStockEntry({
      stock_entry_type: 'Material Issue',
      company: COMPANY,
      remarks: `Dashboard qty-remove [op:${opKey}]${reason ? ` reason: ${safeRemark(reason)}` : ''}`,
      items: [{ item_code: itemCode, qty, s_warehouse: warehouse, allow_zero_valuation_rate: 1, uom, stock_uom: uom, conversion_factor: 1 }],
    }))
  return { stockEntry, itemName, uom, qty, warehouse }
}

// ─── Serialization (reprint / qty-change reissue) ────────────────────────────────
// To stop two physical labels with the same code being usable, a reprint or a qty
// change REISSUES the pallet as a new serial (base -> base-02 -> base-03): produce
// the target qty into the new batch, empty + disable the old one. ERPNext then
// rejects the old/empty/disabled batch natively everywhere (incl. scan-to-ship), so
// stale labels can't be used. See docs/inventory-ops.md.

/** The family base of a serial: "D79C" -> "D79C", "D79C-03" -> "D79C". Only OUR serial
 *  shape (a base32 root + "-NN" suffix) is stripped; a hyphenated non-conforming name
 *  (e.g. a legacy "FOO-12-BAR") is returned whole so unrelated codes never get grouped. */
export function palletBase(b: string): string {
  // Root must be Crockford base32 (digits + A-Z minus I, L, O, U) — the exact alphabet
  // generatePalletId emits — so only OUR serials are split; a legacy hyphenated name
  // (e.g. "FOO-12", with the non-Crockford 'O') is returned whole, never mis-grouped.
  const m = b.match(/^([0-9A-HJKMNP-TV-Z]+)-(\d{2,})$/)
  return m ? m[1] : b
}

/** COMPUTE (do not create) the next serial in a pallet's family. base (no suffix) is
 *  generation 1; serials are base-02, base-03, ... This is compute-only ON PURPOSE: the
 *  caller persists the returned name to inventory_ops_log.result_batch (durable, atomic
 *  with the family lock), and reissuePallet creates the Batch idempotently. Because the
 *  family lock allows only ONE active op per family at a time, no two ops ever allocate a
 *  serial for the same family concurrently — so nothing is created before the op row
 *  exists (no orphaned batch on a crash/race) and there's no cross-op name collision. */
export async function reserveNextSerial(oldBatch: string): Promise<string> {
  const base = palletBase(oldBatch)
  // Highest existing suffix in the family (base itself counts as gen 1).
  const qs = [listParam('filters', [['name', 'like', `${base}-%`]]), listParam('fields', ['name']), 'limit_page_length=0'].join('&')
  const fam = (await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Batch?${qs}`)).data ?? []
  let n = 1
  for (const r of fam) {
    const m = r.name.match(/-(\d+)$/)
    if (m && r.name.startsWith(`${base}-`)) n = Math.max(n, parseInt(m[1], 10))
  }
  return `${base}-${String(n + 1).padStart(2, '0')}`
}

export interface ReissueResult extends Committed {
  newBatch: string
  qty: number
  fromWarehouse: string
}

/** Reissue `oldBatch` as the pre-reserved `newBatch` at `targetQty`. FULLY IDEMPOTENT
 *  / resumable: it recomputes from the CURRENT on-hand of both batches each call and
 *  only does the steps still needed, so it's safe to re-enter after a partial failure
 *  and is used for BOTH erp() and reconcile() under runInventoryOp. End state: new batch
 *  at exactly target, old batch emptied + disabled. The old/empty batch is rejected by
 *  ERPNext natively, so a stale label can't be used. Repacks are 1:1 (qty in = out) so
 *  valuation isn't concentrated; the qty-down excess is issued out and a qty-up shortfall
 *  is received in. */
export async function reissuePallet(input: {
  oldBatch: string
  newBatch: string
  itemCode: string
  targetQty: number
  opKey: string
}): Promise<ReissueResult> {
  const { oldBatch, newBatch, itemCode, targetQty, opKey } = input
  // Don't require the old batch active: on a retry it may already be disabled/empty.
  await assertBatchItem(oldBatch, itemCode, false)
  const target = targetQty
  if (!(target > 0)) throw new Error('reissue target qty must be > 0 (use Remove to zero a pallet)')
  const item = await erpnextGetDoc<{ stock_uom?: string }>('Item', itemCode)
  const uom = item.stock_uom ?? 'Nos'

  // Ensure the (reserved) new batch exists; skip-if-exists so a retry reuses it.
  // Weight/dims carry over from the pallet being reissued (same physical pallet).
  if (!(await erpnextGet(`/api/resource/Batch/${encodeURIComponent(newBatch)}`).then(() => true).catch(() => false))) {
    const old = await erpnextGetDoc<{ custom_pallet_weight?: number; custom_pallet_dims?: string }>(
      'Batch',
      oldBatch
    ).catch(() => null)
    await erpnextCreate('Batch', {
      batch_id: newBatch,
      item: itemCode,
      custom_pallet_qty: target,
      ...(old?.custom_pallet_weight ? { custom_pallet_weight: old.custom_pallet_weight } : {}),
      ...(old?.custom_pallet_dims ? { custom_pallet_dims: old.custom_pallet_dims } : {}),
    })
  }

  const locNew = await getBatchLocation(newBatch, itemCode)
  const currentNew = locNew?.qty ?? 0
  if (locNew?.split) throw new Error(`Pallet ${newBatch} is split across multiple bins; consolidate in ERPNext first`)
  const locOld = await getBatchLocation(oldBatch, itemCode)
  const currentOld = locOld?.qty ?? 0
  if (locOld?.split) throw new Error(`Pallet ${oldBatch} is split across multiple bins; consolidate in ERPNext first`)
  const wh = locOld?.warehouse ?? locNew?.warehouse
  // target is > 0 (asserted above), so we MUST have a bin to place stock. No bin means
  // neither batch holds stock (e.g. a lost concurrency race emptied the old batch first);
  // fail loudly rather than print a label for a zero-stock pallet.
  if (!wh) throw new Error(`Cannot reissue ${oldBatch}: no stock found in either ${oldBatch} or ${newBatch}`)

  const row = (qty: number, batch_no: string, dir: 's_warehouse' | 't_warehouse') => ({
    item_code: itemCode,
    qty,
    [dir]: wh,
    use_serial_batch_fields: 1,
    batch_no,
    allow_zero_valuation_rate: 1,
    uom,
    stock_uom: uom,
    conversion_factor: 1,
  })

  let stockEntry: string | null = null
  // 1) Move from old -> new (1:1 repack), up to what the new batch still needs.
  const moveQty = Math.max(0, Math.min(target - currentNew, currentOld))
  if (moveQty > 0) {
    stockEntry = await submitStockEntry({
      stock_entry_type: 'Repack',
      company: COMPANY,
      remarks: `Dashboard reissue [op:${opKey}]`,
      items: [row(moveQty, oldBatch, 's_warehouse'), row(moveQty, newBatch, 't_warehouse')],
    })
  }
  // 2) Issue out any leftover still in the old batch (qty-down excess).
  const leftoverOld = currentOld - moveQty
  if (leftoverOld > 0) {
    await submitStockEntry({
      stock_entry_type: 'Material Issue',
      company: COMPANY,
      remarks: `Dashboard reissue-excess [op:${opKey}]`,
      items: [row(leftoverOld, oldBatch, 's_warehouse')],
    })
  }
  // 3) Receipt any remaining shortfall into the new batch (qty-up beyond old's stock).
  const shortfall = target - (currentNew + moveQty)
  if (shortfall > 0) {
    await submitStockEntry({
      stock_entry_type: 'Material Receipt',
      company: COMPANY,
      remarks: `Dashboard reissue-delta [op:${opKey}]`,
      items: [row(shortfall, newBatch, 't_warehouse')],
    })
  }
  // 4) Defensive: if the new batch somehow holds MORE than target (e.g. a duplicated
  //    receipt from an earlier aborted run), issue the excess back out so it converges.
  const excessNew = currentNew - target
  if (excessNew > 0) {
    await submitStockEntry({
      stock_entry_type: 'Material Issue',
      company: COMPANY,
      remarks: `Dashboard reissue-trim [op:${opKey}]`,
      items: [row(excessNew, newBatch, 's_warehouse')],
    })
  }

  // Postcondition: new must hold exactly target and old must be empty before we report
  // success (and hand a label to the caller). Otherwise throw -> the op lands
  // failed_pre_erp and a retry/verify finishes the remaining steps.
  const newAfter = await getBatchLocation(newBatch, itemCode)
  if ((newAfter?.qty ?? 0) !== target) {
    throw new Error(`Reissue postcondition failed: ${newBatch} holds ${newAfter?.qty ?? 0}, expected ${target}`)
  }
  const oldAfter = await getBatchLocation(oldBatch, itemCode)
  if (oldAfter && oldAfter.qty > 0) {
    throw new Error(`Reissue postcondition failed: ${oldBatch} still holds ${oldAfter.qty}`)
  }

  await erpnextUpdate('Batch', newBatch, { custom_pallet_qty: target })
  await erpnextUpdate('Batch', oldBatch, { disabled: 1 })

  return { batch: newBatch, stockEntry, newBatch, qty: target, fromWarehouse: wh }
}

/** READ-ONLY completion check for a reissue, used as runInventoryOp's reconcile(). It
 *  NEVER mutates ERP, so it is safe to call while a peer request may still be inside
 *  erp() (the pending/duplicate path). Returns committed ONLY when the reissue is fully
 *  done — new batch holds exactly target AND old batch is drained — else null, so the
 *  state machine refuses or re-runs the mutating erp() under its CAS claim. */
export async function verifyReissue(input: {
  oldBatch: string
  newBatch: string
  itemCode: string
  targetQty: number
}): Promise<Committed | null> {
  const { oldBatch, newBatch, itemCode, targetQty } = input
  const locNew = await getBatchLocation(newBatch, itemCode)
  if ((locNew?.qty ?? 0) !== targetQty) return null
  const locOld = await getBatchLocation(oldBatch, itemCode)
  if (locOld && locOld.qty > 0) return null
  // The old batch must also be disabled, not merely drained: if the disable step was the
  // part that failed, report NOT-complete so the state machine re-runs erp() and retries
  // it. (If the old batch doc is simply gone, there's nothing left to disable.)
  const oldDoc = await erpnextGetDoc<{ disabled?: number }>('Batch', oldBatch).catch(() => null)
  if (oldDoc && oldDoc.disabled !== 1) return null
  return { batch: newBatch, stockEntry: null }
}

/** Resolve any serial in a family to the CURRENT one and whether the scanned id is
 *  superseded. The current pallet is the highest-numbered ACTIVE (disabled=0) serial
 *  THAT HOLDS STOCK. We can't just take the highest active serial: reserveNextSerial
 *  creates the next serial as an active, zero-stock batch BEFORE the reissue moves stock
 *  into it, and if that reissue fails permanently the real stock is still in the prior
 *  serial. Preferring the highest stocked serial keeps a scan pointed at the physical
 *  pallet. Only if NONE hold stock do we fall back to the highest active serial (so we
 *  never strand the user on null). The per-candidate stock check is bounded — a family
 *  has at most a handful of serials over its life. */
export async function resolveCurrentSerial(scanned: string): Promise<{ current: string | null; superseded: boolean }> {
  // Uppercase: pallet codes are Crockford base32, but a TYPED search arrives
  // as-typed ("9By7"). MariaDB matched anyway; the JS family filter below did
  // not, so a lowercase search resolved to "no active serial" for a pallet
  // that had full stock (Simon's SO-00013 report, 2026-07-03).
  const base = palletBase(scanned).toUpperCase()
  const qs = [
    listParam('or_filters', [['name', '=', base], ['name', 'like', `${base}-%`]]),
    listParam('filters', [['disabled', '=', 0]]),
    listParam('fields', ['name']),
    'limit_page_length=0',
  ].join('&')
  const rows = (await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Batch?${qs}`)).data ?? []
  const ranked = rows
    .filter((r) => r.name === base || r.name.startsWith(`${base}-`))
    .sort((a, b) => {
      const na = parseInt(a.name.match(/-(\d+)$/)?.[1] ?? '1', 10)
      const nb = parseInt(b.name.match(/-(\d+)$/)?.[1] ?? '1', 10)
      return nb - na
    })
  if (ranked.length === 0) return { current: null, superseded: true }
  // Every serial in a family is the same item; read it once from a real batch doc
  // rather than trusting the caller to pass the right item code.
  const fam = await erpnextGetDoc<{ item?: string }>('Batch', ranked[0].name).catch(() => null)
  const itemCode = fam?.item
  if (itemCode) {
    for (const r of ranked) {
      const loc = await getBatchLocation(r.name, itemCode)
      if (loc && loc.qty > 0) return { current: r.name, superseded: r.name !== scanned }
    }
  }
  const current = ranked[0].name
  return { current, superseded: current !== scanned }
}

// ─── Deleted-pallet lookup + restore ──────────────────────────────────────────────
// A removed pallet is issued out + its batch disabled (removeInventory), so it drops off
// the normal stocked views. Simon wants to still SCAN a removed pallet, see its data at
// zero, and RESTORE it (return its stock) — same qty keeps the same label, a different qty
// reissues a new serial + new label.

const suffixNum = (name: string): number => parseInt(name.match(/-(\d+)$/)?.[1] ?? '1', 10)

export interface RemovedPalletInfo {
  batch: string // canonical (latest) serial in the family
  itemCode: string
  itemName: string
  labelQty: number // custom_pallet_qty — the qty that was printed on the label
  lastWarehouse: string | null // last bin it was in (from the stock ledger) — restore target
  uom: string
  family: string[] // every serial in the family — lets the caller match logs
}

/** Most recent warehouse a batch was in, from the Stock Ledger Entry (the bin it was issued
 *  out of on removal). Used to restore a removed pallet back to where it physically still is. */
async function lastWarehouseForBatch(batch: string): Promise<string | null> {
  const qs = [
    listParam('filters', [['batch_no', '=', batch]]),
    listParam('fields', ['warehouse']),
    'order_by=creation desc',
    'limit_page_length=1',
  ].join('&')
  const rows = (await erpnextGet<{ data: { warehouse: string }[] }>(`/api/resource/Stock Ledger Entry?${qs}`)).data ?? []
  return rows[0]?.warehouse ?? null
}

/** If a scanned code's pallet family has NO active serial holding stock (it was removed /
 *  zeroed), return the removed pallet's display data so the UI can show it at zero and offer
 *  a restore. Returns null if the family still has live stock (the normal locate / superseded
 *  path handles that) or the code isn't a known batch. */
export async function lookupRemovedPallet(code: string): Promise<RemovedPalletInfo | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  // Pallet codes are uppercase Crockford base32 but the scanned string arrives
  // as-typed. MariaDB matches case-insensitively; the JS family filter below
  // does NOT — a lowercase search ("9By7") returned null and the UI showed a
  // bare one-liner instead of the zero-stock card (Simon, 2026-07-03).
  const base = palletBase(trimmed).toUpperCase()
  const qs = [
    listParam('or_filters', [['name', '=', base], ['name', 'like', `${base}-%`]]),
    listParam('fields', ['name', 'item', 'disabled', 'custom_pallet_qty']),
    'limit_page_length=0',
  ].join('&')
  const rows =
    (await erpnextGet<{ data: { name: string; item: string; disabled: number; custom_pallet_qty: number }[] }>(`/api/resource/Batch?${qs}`)).data ?? []
  const fam = rows.filter((r) => r.name === base || r.name.startsWith(`${base}-`))
  if (fam.length === 0) return null
  // If any serial still holds stock, the pallet isn't removed — let the normal path handle it.
  for (const r of fam) {
    const loc = await getBatchLocation(r.name, r.item)
    if (loc && loc.qty > 0) return null
  }
  // Removed: the latest serial (highest suffix) is the canonical identity to restore.
  const latest = [...fam].sort((a, b) => suffixNum(a.name) - suffixNum(b.name)).at(-1)!
  const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', latest.item).catch(() => null)
  return {
    batch: latest.name,
    itemCode: latest.item,
    itemName: item?.item_name ?? latest.item,
    labelQty: Number(latest.custom_pallet_qty) || 0,
    lastWarehouse: await lastWarehouseForBatch(latest.name),
    uom: item?.stock_uom ?? 'pcs',
    family: fam.map((r) => r.name),
  }
}

/** Best-effort label qty + last bin for a set of removed pallets, for the deletions log.
 *  Both survive removal: the Batch (with custom_pallet_qty) is disabled, not deleted, and the
 *  Stock Ledger keeps the bin it was issued out of. One batched Batch query for the qty; the
 *  last bin per batch in parallel. Missing/errored lookups degrade to null rather than failing
 *  the panel — the restore form lets the user type the qty / pick the bin. */
export async function deletedPalletMeta(
  batches: string[]
): Promise<Map<string, { labelQty: number | null; lastWarehouse: string | null }>> {
  const out = new Map<string, { labelQty: number | null; lastWarehouse: string | null }>()
  const uniq = [...new Set(batches.filter(Boolean))]
  if (uniq.length === 0) return out

  const qtyMap = new Map<string, number>()
  try {
    const qs = [
      listParam('filters', [['name', 'in', uniq]]),
      listParam('fields', ['name', 'custom_pallet_qty']),
      'limit_page_length=0',
    ].join('&')
    const rows =
      (await erpnextGet<{ data: { name: string; custom_pallet_qty: number }[] }>(`/api/resource/Batch?${qs}`)).data ?? []
    for (const r of rows) qtyMap.set(r.name, Number(r.custom_pallet_qty) || 0)
  } catch (e) {
    console.error('deletedPalletMeta: batch qty lookup failed:', (e as Error).message)
  }

  const bins = await Promise.all(uniq.map((b) => lastWarehouseForBatch(b).catch(() => null)))
  uniq.forEach((b, i) => out.set(b, { labelQty: qtyMap.has(b) ? qtyMap.get(b)! : null, lastWarehouse: bins[i] }))
  return out
}

/** True if ANY serial in a pallet's family currently holds stock. Restoring a pallet that's
 *  already back in stock would double-count it — this is the authoritative server-side guard
 *  against a stale/duplicate restore (a stale deletions panel, a fail-open status lookup, or a
 *  different-qty re-restore of the now-zero old serial while a reissued serial holds the stock).
 *  Scans the whole family because a reissue restore moves stock to a NEW serial. */
export async function familyHasLiveStock(batch: string): Promise<boolean> {
  const base = palletBase(batch)
  const qs = [
    listParam('or_filters', [['name', '=', base], ['name', 'like', `${base}-%`]]),
    listParam('fields', ['name', 'item']),
    'limit_page_length=0',
  ].join('&')
  const rows =
    (await erpnextGet<{ data: { name: string; item: string }[] }>(`/api/resource/Batch?${qs}`)).data ?? []
  const fam = rows.filter((r) => r.name === base || r.name.startsWith(`${base}-`))
  for (const r of fam) {
    const loc = await getBatchLocation(r.name, r.item)
    if (loc && loc.qty > 0) return true
  }
  return false
}

export interface RestoreResult extends Committed {
  newLabel: boolean // true when a different qty forced a new serial + new label
  qty: number
  warehouse: string
}

/** Return a removed pallet's stock to inventory. Re-receipts `requestedQty` into `warehouse`.
 *  If requestedQty equals the label qty, the SAME serial is re-enabled and re-stocked (its
 *  printed label is still valid — no new label). If it differs, the pallet is reissued as a
 *  new serial (`newBatch`) at the new qty and a new label is printed; the old serial stays
 *  disabled. Idempotent via runInventoryOp + the [op:key] stamp (reconcileStockEntry). */
export async function restorePallet(input: {
  batch: string
  itemCode: string
  requestedQty: number
  warehouse: string
  newBatch?: string | null
  opKey: string
}): Promise<RestoreResult> {
  const { batch, itemCode, requestedQty, warehouse, newBatch, opKey } = input
  if (!(requestedQty > 0)) throw new Error('Restore qty must be greater than 0')
  // Old batch must exist + belong to the item; it may be disabled (it was removed).
  await assertBatchItem(batch, itemCode, false)
  const { uom } = await preflight(itemCode, warehouse) // validates the destination bin too

  // Authoritative label qty from the batch itself (don't trust the client to decide same vs new).
  const oldDoc = await erpnextGetDoc<{ custom_pallet_qty?: number }>('Batch', batch)
  const labelQty = Number(oldDoc.custom_pallet_qty) || 0
  const sameQty = requestedQty === labelQty
  const target = sameQty ? batch : (newBatch as string)
  if (!target) throw new Error('A new serial must be reserved to restore at a different quantity')

  // Resume check first: if this op's receipt already posted, reuse it (don't re-receipt).
  const existing = await reconcileStockEntry(opKey)
  if (!existing) {
    // Precondition: restore applies ONLY to a removed/zeroed pallet. Assert the pallet holds
    // 0 on-hand at the lib layer so a crafted or replayed request can't re-stock an ACTIVE
    // pallet (which would double-count). Only checked on a fresh post — on a resume the
    // receipt has already moved stock, so a >0 reading there is expected.
    const loc = await getBatchLocation(batch, itemCode)
    if (loc && loc.qty > 0) {
      throw new Error(`Pallet ${batch} still holds ${loc.qty} in stock; it is not a removed pallet`)
    }
  }

  if (sameQty) {
    // Re-enable BEFORE receipting (ERPNext rejects stock into a disabled batch).
    await erpnextUpdate('Batch', batch, { disabled: 0 })
  } else if (!(await erpnextGet(`/api/resource/Batch/${encodeURIComponent(target)}`).then(() => true).catch(() => false))) {
    await erpnextCreate('Batch', { batch_id: target, item: itemCode, custom_pallet_qty: requestedQty })
  }

  const stockEntry =
    existing ??
    (await submitStockEntry({
      stock_entry_type: 'Material Receipt',
      company: COMPANY,
      remarks: `Dashboard restore [op:${opKey}]`,
      items: [
        {
          item_code: itemCode,
          qty: requestedQty,
          t_warehouse: warehouse,
          use_serial_batch_fields: 1,
          batch_no: target,
          allow_zero_valuation_rate: 1,
          uom,
          stock_uom: uom,
          conversion_factor: 1,
        },
      ],
    }))

  await erpnextUpdate('Batch', target, { custom_pallet_qty: requestedQty })

  return { batch: target, stockEntry, newLabel: !sameQty, qty: requestedQty, warehouse }
}
