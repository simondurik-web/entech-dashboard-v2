import { createHash } from 'crypto'
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

/** Deterministic pallet/batch id derived from the idempotency key, so a retry
 *  of the same add reuses the same batch instead of orphaning a new one. */
export function batchIdFor(itemCode: string, opKey: string): string {
  const clean = itemCode.replace(/[^A-Za-z0-9.\-]/g, '').slice(0, 20)
  const suffix = createHash('sha1').update(opKey).digest('hex').slice(0, 8).toUpperCase()
  return `PLT-${clean}-${suffix}`
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
}

export interface AddInventoryResult extends Committed {
  itemName: string
  uom: string
}

/** Receive a new pallet: create the (deterministic) Batch, post a Material
 *  Receipt binding it (use_serial_batch_fields + batch_no both required), submit.
 *  The Stock Entry is stamped [op:<key>] for reconcile. */
export async function addInventory(input: AddInventoryInput): Promise<AddInventoryResult> {
  const { itemCode, qty, warehouse, opKey } = input
  const { itemName, uom } = await preflight(itemCode, warehouse)
  const batch = batchIdFor(itemCode, opKey)

  // Batch create is skip-if-exists (deterministic id), so a retry reuses it.
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
