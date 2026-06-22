import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { reserveNextSerial, reissuePallet, verifyReissue, removeInventory, reconcileStockEntry, assertBatchItem, getBatchLocation, palletBase } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp } from '@/lib/erpnext/label'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/adjust — change a pallet's qty, SERIALIZED.
// A qty change REISSUES the pallet as the next serial at the new qty and disables the
// old (so the old "100" label can't still be used after you change it to 50). Setting
// qty to 0 is treated as a soft Remove instead. Logged + idempotent (serial reused on
// retry; Repack/Issue reconciles by op key).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000

interface AdjustBody {
  batch?: string
  itemCode?: string
  newQty?: number
  station?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AdjustBody
  try {
    body = (await req.json()) as AdjustBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, station, idempotencyKey } = body
  const newQty = Number(body.newQty)
  if (!batch || !itemCode || !Number.isFinite(newQty) || newQty < 0 || newQty > MAX_QTY || !station || !idempotencyKey) {
    return NextResponse.json({ error: 'batch, itemCode, newQty (0..10M), station, and idempotencyKey are required' }, { status: 400 })
  }

  const { data: stationRow } = await supabaseAdmin
    .from('print_stations')
    .select('id')
    .eq('id', station)
    .eq('enabled', true)
    .single()
  if (!stationRow) {
    return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
  }

  const userId = guard.userId
  const printedBy = await resolveUserName(userId)

  // Retry detection: if this op already started, skip the old-batch validation (the old
  // batch may already be empty/disabled) and reuse the reserved serial.
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('result_batch, qty')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  const isRetry = !!priorOp
  // Pin the target qty to the FIRST intent: a same-key retry with a different newQty
  // (double-submit of an edited form) must still reissue to the originally-logged qty.
  const target = isRetry ? Number(priorOp?.qty) : newQty

  if (!isRetry) {
    try {
      await assertBatchItem(batch, itemCode)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
    const loc = await getBatchLocation(batch, itemCode)
    // Deterministic preflight BEFORE the locked op row exists, for BOTH branches (a reissue
    // and the qty-0 soft-remove): a split pallet can't be reissued OR cleanly removed, so
    // reject it as a 400 here rather than letting reissuePallet/removeInventory throw after
    // the insert (which would leave the family locked in failed_pre_erp).
    if (loc?.split) {
      return NextResponse.json({ error: `Pallet ${batch} is split across multiple bins; consolidate in ERPNext first.` }, { status: 400 })
    }
    // A reissue to a non-zero qty needs the pallet's current bin to know where to repack;
    // an empty pallet has none. (Setting qty to 0 is the soft-remove branch below.)
    if (target > 0) {
      if (!loc || loc.qty <= 0) {
        return NextResponse.json({ error: `Pallet ${batch} has no stock; add a new pallet instead of adjusting.` }, { status: 400 })
      }
      // No-op: adjusting to the qty it already holds would needlessly burn a serial and
      // reprint. Tell the caller nothing changed (Reprint is the way to re-issue a label).
      if (loc.qty === target) {
        return NextResponse.json({ ok: true, batch, qty: target, unchanged: true }, { status: 200 })
      }
    }
    // Friendly pre-check (the partial unique index on `family` is the atomic guarantee):
    // reject if any serial in this pallet's family already has an active op.
    const { data: inflight } = await supabaseAdmin
      .from('inventory_ops_log')
      .select('idempotency_key')
      .eq('family', palletBase(batch))
      .in('status', ['pending', 'erp_committed', 'failed_pre_erp'])
      .neq('idempotency_key', idempotencyKey)
      .limit(1)
    if (inflight && inflight.length) {
      return NextResponse.json({ error: 'Another operation is in progress for this pallet; try again shortly.' }, { status: 409 })
    }
  }

  // Qty 0 = soft remove (issue-out + disable), no reissue, no label. Branch on the PINNED
  // target (not the raw request) so a same-key retry can't divert an adjust-to-50 into a
  // remove just because a buggy retry sent newQty:0.
  if (target === 0) {
    const result = await runInventoryOp({
      key: idempotencyKey,
      action: 'remove',
      createdBy: userId,
      meta: { item_code: itemCode, qty: 0, station_id: station, batch, family: palletBase(batch) },
      erp: () => removeInventory({ batch, itemCode, reason: 'adjusted to 0', opKey: idempotencyKey }),
      reconcile: async () => {
        const se = await reconcileStockEntry(idempotencyKey)
        return se ? { batch, stockEntry: se } : null
      },
    })
    return NextResponse.json(result.body, { status: result.status })
  }

  // Reserve the new serial once; reuse on retry.
  const newBatch: string = priorOp?.result_batch ?? (await reserveNextSerial(batch))

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'adjust',
    createdBy: userId,
    meta: { item_code: itemCode, qty: target, station_id: station, batch, family: palletBase(batch), result_batch: newBatch },
    erp: () => reissuePallet({ oldBatch: batch, newBatch, itemCode, targetQty: target, opKey: idempotencyKey }),
    // reconcile is READ-ONLY (see reprint route): reports done only if already complete,
    // else null and the state machine re-runs erp() (reissuePallet) under its CAS claim.
    reconcile: () => verifyReissue({ oldBatch: batch, newBatch, itemCode, targetQty: target }),
    label: async (committed) => {
      const printBatch = committed.batch ?? newBatch
      const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
      const zpl = buildPalletZpl({
        itemCode,
        itemName: item.item_name ?? itemCode,
        qty: target,
        uom: item.stock_uom ?? 'pcs',
        batch: printBatch,
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
            batch: printBatch,
            created_by: userId,
            idempotency_key: `print-${idempotencyKey}`,
            status: 'pending',
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (job?.id) return job.id
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
