import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import {
  restorePallet,
  reconcileStockEntry,
  reserveNextSerial,
  assertBatchItem,
  palletBase,
  familyHasLiveStock,
} from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp } from '@/lib/erpnext/label'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/restore — return a removed pallet's stock to inventory.
// Same qty as the label  -> re-enable the SAME serial + re-receipt it (no new label;
//                           the printed label on the box is still valid).
// Different qty           -> reissue as a NEW serial at the new qty + print a new label;
//                           the old serial stays disabled. The client warns the user first.
// Idempotent + resumable via the client idempotencyKey (reserved serial + target qty are
// persisted on first attempt and reused on retry).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000
// Restoring stock (re-receipting a removed pallet) is office-only, like removal.
const OFFICE_ROLES = new Set(['admin', 'super_admin', 'manager', 'shipping_manager', 'advanced_user', 'shipping_team'])

interface RestoreBody {
  batch?: string
  itemCode?: string
  qty?: number
  warehouse?: string
  station?: string // required only when the qty differs (a new label is printed)
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res
  if (!OFFICE_ROLES.has(guard.role)) {
    return NextResponse.json({ error: 'Returning a pallet to inventory is office-only' }, { status: 403 })
  }

  let body: RestoreBody
  try {
    body = (await req.json()) as RestoreBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, warehouse, station, idempotencyKey } = body
  const qty = Number(body.qty)
  // Quantities are whole units — require a positive integer.
  if (!batch || !itemCode || !warehouse || !idempotencyKey || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) {
    return NextResponse.json(
      { error: 'batch, itemCode, a whole-number qty (1..10M), warehouse, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  // Retry detection: reuse the reserved new serial (if a different-qty reissue) + decision.
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('result_batch')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  let newBatch: string | null = priorOp?.result_batch ?? null
  let willReissue = !!newBatch

  if (!priorOp) {
    // First attempt: validate, decide same-vs-new from the AUTHORITATIVE label qty on the
    // batch, and reserve a serial if the qty differs.
    try {
      await assertBatchItem(batch, itemCode, false) // may be disabled (it was removed)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
    // Authoritative "already restored" guard: if any serial in this pallet's family already
    // holds stock, this pallet is back in inventory — restoring again would double-count it.
    // Do NOT rely on the client/read-model `restored` flag (a stale tab or a fail-open status
    // lookup could still POST here). A reissue restore moves stock to a new serial, so the
    // submitted (now-zero) old batch wouldn't be caught by a batch-only check — scan the family.
    if (await familyHasLiveStock(batch)) {
      return NextResponse.json({ error: 'This pallet is already in stock (it was already returned to inventory).' }, { status: 409 })
    }
    const doc = await erpnextGetDoc<{ custom_pallet_qty?: number }>('Batch', batch).catch(() => null)
    const labelQty = Number(doc?.custom_pallet_qty) || 0
    willReissue = qty !== labelQty

    // Same-pallet concurrency guard (the partial unique index on `family` is the atomic one).
    const { data: inflight } = await supabaseAdmin
      .from('inventory_ops_log')
      .select('idempotency_key')
      .eq('family', palletBase(batch))
      .in('status', ['pending', 'erp_committed'])
      .neq('idempotency_key', idempotencyKey)
      .limit(1)
    if (inflight && inflight.length) {
      // Only genuinely ACTIVE ops block. A failed_pre_erp holder is intentionally NOT in
      // the filter above: it's a dead op (ERP never committed) and runInventoryOp
      // supersedes it atomically on the next attempt — before 2026-07-14 it jammed the
      // family forever ("ask an admin to clear it": Joseles's 4JA5 + 10 more pallets).
      return NextResponse.json({ error: 'Another operation is in progress for this pallet; try again shortly.' }, { status: 409 })
    }

    if (willReissue) newBatch = await reserveNextSerial(batch)
  }

  // A different qty prints a new label, which needs a printer station.
  if (willReissue && !station) {
    return NextResponse.json({ error: 'A printer station is required to restore at a different quantity (a new label is printed).' }, { status: 400 })
  }
  if (willReissue && station) {
    const { data: stationRow } = await supabaseAdmin.from('print_stations').select('id').eq('id', station).eq('enabled', true).single()
    if (!stationRow) {
      return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
    }
    if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
      return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
    }
  }

  const userId = guard.userId
  const target = willReissue ? (newBatch as string) : batch

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'restore',
    createdBy: userId,
    meta: {
      item_code: itemCode,
      qty,
      warehouse,
      station_id: willReissue ? station : null,
      batch,
      family: palletBase(batch),
      result_batch: willReissue ? newBatch : null,
    },
    erp: () => restorePallet({ batch, itemCode, requestedQty: qty, warehouse, newBatch, opKey: idempotencyKey }),
    // Proof required before superseding a dead op that holds this pallet family:
    // did ERP commit any stock document under THAT op's key? (see runInventoryOp)
    erpTouchedKey: (k) => reconcileStockEntry(k).then(Boolean),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch: target, stockEntry: se } : null
    },
    // Only a different-qty restore prints a label (a new serial). Same-qty keeps the
    // existing physical label, so no label step runs.
    label: willReissue
      ? async (committed) => {
          const printBatch = committed.batch ?? target
          const printedBy = await resolveUserName(userId)
          const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
          const zpl = buildPalletZpl({
            itemCode,
            itemName: item.item_name ?? itemCode,
            qty,
            uom: item.stock_uom ?? 'pcs',
            batch: printBatch,
            generatedAt: labelTimestamp(),
            printedBy,
          })
          const { data: job, error } = await supabaseAdmin
            .from('print_jobs')
            .upsert(
              { station_id: station, zpl, item_code: itemCode, batch: printBatch, created_by: userId, idempotency_key: `print-${idempotencyKey}`, status: 'pending' },
              { onConflict: 'idempotency_key', ignoreDuplicates: true }
            )
            .select('id')
            .maybeSingle()
          if (error) throw new Error(error.message)
          if (job?.id) return job.id
          const { data: existing } = await supabaseAdmin.from('print_jobs').select('id').eq('idempotency_key', `print-${idempotencyKey}`).maybeSingle()
          return existing?.id ?? null
        }
      : undefined,
  })

  return NextResponse.json({ ...result.body, newLabel: willReissue }, { status: result.status })
}
