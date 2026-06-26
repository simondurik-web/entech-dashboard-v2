import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { addInventory, generatePalletId, reconcileStockEntry, palletBase, getItemInfo, qtyReceive } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp } from '@/lib/erpnext/label'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/add
// Receives a new pallet into ERPNext AND always creates + enqueues a label.
// Idempotent + resumable via the client-supplied idempotencyKey (a double-tap
// or a timeout-then-retry can never create two receipts).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000

interface AddBody {
  itemCode?: string
  qty?: number
  warehouse?: string
  station?: string
  customer?: string
  ref?: string
  salesOrder?: string // optional ERPNext Sales Order to attach (printed on the label)
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AddBody
  try {
    body = (await req.json()) as AddBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { itemCode, warehouse, station, customer, ref, idempotencyKey } = body
  const salesOrder = body.salesOrder?.trim() || undefined
  const qty = Number(body.qty)
  if (!itemCode || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY || !warehouse || !station || !idempotencyKey) {
    return NextResponse.json(
      { error: 'itemCode, qty (1..10M), warehouse, station, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  // Validate the station before any ERP write.
  const { data: stationRow } = await supabaseAdmin
    .from('print_stations')
    .select('id')
    .eq('id', station)
    .eq('enabled', true)
    .single()
  if (!stationRow) {
    return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
  }
  if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
    return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
  }

  const userId = guard.userId // verified from the session, not a client header
  const printedBy = await resolveUserName(userId)

  // Serialized (pallet) vs non-serialized (quantity) item — decided by ERPNext's batch flag.
  let itemInfo: { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }
  try {
    itemInfo = await getItemInfo(itemCode)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // ─── Non-serialized: receive a quantity (boxes) + print one generic label per box ───
  if (!itemInfo.hasBatch) {
    // One label per box. Cap at 10 labels per receive so a fat-finger (e.g. 500) can't
    // flood the printer — the floor receives in small batches, and a bigger receipt is
    // split into multiple adds. (Simon 2026-06-25, all non-serialized items.)
    const MAX_LABELS_PER_RECEIVE = 10
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LABELS_PER_RECEIVE) {
      return NextResponse.json(
        {
          error: `Maximum ${MAX_LABELS_PER_RECEIVE} labels at a time for non-serialized items (one label per box). Split larger receipts.`,
          code: 'max_labels',
          max: MAX_LABELS_PER_RECEIVE,
        },
        { status: 400 }
      )
    }
    const result = await runInventoryOp({
      key: idempotencyKey,
      action: 'add',
      createdBy: userId,
      // No batch/family for a quantity item; family null keeps it outside the pallet lock.
      meta: { item_code: itemCode, qty, warehouse, station_id: station, batch: null, family: null },
      erp: () => qtyReceive({ itemCode, qty, warehouse, opKey: idempotencyKey }),
      reconcile: async () => {
        const se = await reconcileStockEntry(idempotencyKey)
        return se ? { stockEntry: se } : null
      },
      label: async () => {
        // Generic label: part # + label quantity + QR of the PART NUMBER (no unique pallet
        // code). One copy per box (^PQ via `copies`). The label quantity is the item's
        // custom_pieces_per_pack when set, else 1 (a pack is itself one assembly).
        const zpl = buildPalletZpl({
          itemCode,
          itemName: itemInfo.itemName,
          qty: itemInfo.piecesPerPack, // quantity printed on the label (default 1 = one assembly/pack)
          uom: itemInfo.uom,
          batch: '', // no pallet code on a generic label
          qrPayload: itemCode, // scan identifies the product
          copies: qty, // one label per box
          customer,
          ref,
          salesOrder,
          generatedAt: labelTimestamp(),
          printedBy,
        })
        const { data: job, error } = await supabaseAdmin
          .from('print_jobs')
          .upsert(
            { station_id: station, zpl, item_code: itemCode, batch: null, created_by: userId, idempotency_key: `print-${idempotencyKey}`, status: 'pending' },
            { onConflict: 'idempotency_key', ignoreDuplicates: true }
          )
          .select('id')
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (job?.id) return job.id
        const { data: existing } = await supabaseAdmin.from('print_jobs').select('id').eq('idempotency_key', `print-${idempotencyKey}`).maybeSingle()
        return existing?.id ?? null
      },
    })
    return NextResponse.json(result.body, { status: result.status })
  }

  // Pallet id: reuse the one already reserved for this op (a retry), else mint a
  // fresh unique code. Reusing it keeps retries idempotent — addInventory's Batch
  // create is skip-if-exists, and reconcile reports the same id — so a
  // timeout-then-retry can never orphan a second pallet.
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('batch')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  const batch: string = priorOp?.batch ?? (await generatePalletId())

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'add',
    createdBy: userId,
    meta: { item_code: itemCode, qty, warehouse, station_id: station, batch, family: palletBase(batch) },
    erp: () => addInventory({ itemCode, qty, warehouse, opKey: idempotencyKey, batch }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
    label: async (committed) => {
      const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
      const zpl = buildPalletZpl({
        itemCode,
        itemName: item.item_name ?? itemCode,
        qty,
        uom: item.stock_uom ?? 'pcs',
        batch: committed.batch ?? batch,
        customer,
        ref,
        salesOrder,
        generatedAt: labelTimestamp(),
        printedBy,
      })
      const { data: job, error } = await supabaseAdmin
        .from('print_jobs')
        .upsert(
          {
            station_id: station,
            zpl,
            item_code: itemCode,
            batch: committed.batch ?? batch,
            created_by: userId,
            idempotency_key: `print-${idempotencyKey}`,
            status: 'pending',
          },
          // Insert-or-IGNORE: a retry with the same key must never reset an
          // already-claimed/printed job back to pending (would reprint it).
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (job?.id) return job.id
      // Conflict (job already queued): recover its id so the op log keeps the link.
      const { data: existing } = await supabaseAdmin
        .from('print_jobs')
        .select('id')
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .maybeSingle()
      return existing?.id ?? null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
