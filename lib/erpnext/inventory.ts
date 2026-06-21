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

// ERPNext stock operations for the inventory-ops module. Company is fixed to
// Molding (the only operating company). All writes are server-side only and
// driven through runInventoryOp (idempotency + state machine).

const COMPANY = 'Molding'

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
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
}

export interface AddInventoryResult extends Committed {
  itemName: string
  uom: string
}

/** Receive a new pallet: create the (deterministic) Batch, post a Material
 *  Receipt binding it (use_serial_batch_fields + batch_no both required), submit.
 *  The Stock Entry is stamped [op:<key>] for reconcile. */
export async function addInventory(input: AddInventoryInput): Promise<AddInventoryResult> {
  const { itemCode, qty, warehouse, opKey, batch } = input
  const { itemName, uom } = await preflight(itemCode, warehouse)

  // Batch create is skip-if-exists (the id is reserved per op + reused on retry),
  // so a retry of the same add reuses the batch instead of orphaning a new one.
  if (!(await erpnextGet(`/api/resource/Batch/${encodeURIComponent(batch)}`).then(() => true).catch(() => false))) {
    await erpnextCreate('Batch', { batch_id: batch, item: itemCode, custom_pallet_qty: qty })
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
  const r = await erpnextCallGet<{ message?: { warehouse: string; qty: number }[] }>(
    'erpnext.stock.doctype.batch.batch.get_batch_qty',
    { batch_no: batch, item_code: itemCode }
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
}

/** List the on-hand pallets (batches) for an item, for the manage/edit view. */
export async function listPallets(itemCode: string): Promise<Pallet[]> {
  const qs = [
    listParam('filters', [
      ['item', '=', itemCode],
      ['disabled', '=', 0],
    ]),
    listParam('fields', ['name']),
    'order_by=creation desc',
    'limit_page_length=25',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Batch?${qs}`)
  const names = (r.data ?? []).map((b) => b.name)
  const located = await Promise.all(
    names.map(async (b) => {
      const loc = await getBatchLocation(b, itemCode)
      return loc && loc.qty > 0 ? { batch: b, warehouse: loc.warehouse, qty: loc.qty } : null
    })
  )
  return located.filter((p): p is Pallet => p !== null)
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
      remarks: `Dashboard remove [op:${opKey}] reason: ${reason.slice(0, 120)}`,
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

/** Move a pallet between bins: a Material Transfer of the batch's full on-hand qty
 *  from its current warehouse to `toWarehouse`. Refuses split pallets (can't guess
 *  which bin to move) and no-op moves. */
export async function transferInventory(input: {
  batch: string
  itemCode: string
  toWarehouse: string
  opKey: string
}): Promise<TransferResult> {
  const { batch, itemCode, toWarehouse, opKey } = input
  await assertBatchItem(batch, itemCode)
  // Validate the destination bin (exists, not a group, enabled, right company).
  const item = await preflight(itemCode, toWarehouse)
  const uom = item.uom

  const loc = await getBatchLocation(batch, itemCode)
  if (!loc || loc.qty <= 0) throw new Error(`Pallet ${batch} has no stock to move`)
  if (loc.split) throw new Error(`Pallet ${batch} is split across multiple bins; consolidate in ERPNext first`)
  // Already at the destination: treat as a no-op success so a timeout+retry of a
  // move that already committed resolves cleanly instead of erroring.
  if (loc.warehouse === toWarehouse) {
    return { batch, stockEntry: null, fromWarehouse: loc.warehouse, toWarehouse, qty: loc.qty }
  }

  const stockEntry = await submitStockEntry({
    stock_entry_type: 'Material Transfer',
    company: COMPANY,
    remarks: `Dashboard move [op:${opKey}]`,
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
  })

  return { batch, stockEntry, fromWarehouse: loc.warehouse, toWarehouse, qty: loc.qty }
}
