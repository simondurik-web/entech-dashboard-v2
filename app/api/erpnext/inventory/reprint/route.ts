import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { getBatchLocation, assertBatchItem, reserveNextSerial, reissuePallet, verifyReissue, palletBase } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp } from '@/lib/erpnext/label'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/reprint — reprint a pallet's label, SERIALIZED.
// Reissues the pallet as the next serial (D79C -> D79C-02) at the same qty and disables
// the old, so two usable labels can't share a code. Idempotent: the reserved serial +
// target qty are persisted on first attempt and reused on retry; reissuePallet is
// fully resumable and runs as both erp() and reconcile().

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ReprintBody {
  batch?: string
  itemCode?: string
  station?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: ReprintBody
  try {
    body = (await req.json()) as ReprintBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, station, idempotencyKey } = body
  if (!batch || !itemCode || !station || !idempotencyKey) {
    return NextResponse.json({ error: 'batch, itemCode, station, and idempotencyKey are required' }, { status: 400 })
  }

  const { data: stationRow } = await supabaseAdmin.from('print_stations').select('id').eq('id', station).eq('enabled', true).single()
  if (!stationRow) {
    return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
  }
  if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
    return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
  }

  const userId = guard.userId
  const printedBy = await resolveUserName(userId)

  // Retry detection: if this op already started, reuse the reserved serial + target
  // and SKIP the old-batch validation (the old batch may already be empty/disabled).
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('result_batch, qty')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  let newBatch: string
  let target: number
  if (priorOp?.result_batch) {
    newBatch = priorOp.result_batch
    target = Number(priorOp.qty) || 0
  } else {
    // First attempt: validate, guard against a concurrent op on this pallet, reserve.
    try {
      await assertBatchItem(batch, itemCode)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
    const loc = await getBatchLocation(batch, itemCode)
    if (!loc || loc.qty <= 0) {
      return NextResponse.json({ error: `Pallet ${batch} has no stock to reprint` }, { status: 400 })
    }
    // Deterministic preflight BEFORE we create the locked op row: a split pallet can never
    // be reissued, so reject it as a 400 here rather than letting reissuePallet throw after
    // the insert (which would leave the family locked in failed_pre_erp).
    if (loc.split) {
      return NextResponse.json({ error: `Pallet ${batch} is split across multiple bins; consolidate in ERPNext first.` }, { status: 400 })
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
    target = loc.qty
    newBatch = await reserveNextSerial(batch)
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'reprint',
    createdBy: userId,
    meta: { item_code: itemCode, qty: target, station_id: station, batch, family: palletBase(batch), result_batch: newBatch },
    erp: () => reissuePallet({ oldBatch: batch, newBatch, itemCode, targetQty: target, opKey: idempotencyKey }),
    // reconcile is READ-ONLY: it only reports done if the reissue already completed, so it
    // is safe to call while a peer request may still be mutating. Incomplete -> null, and
    // the state machine re-runs erp() (reissuePallet) under its CAS claim.
    reconcile: () => verifyReissue({ oldBatch: batch, newBatch, itemCode, targetQty: target }),
    label: async (committed) => {
      const printBatch = committed.batch ?? newBatch
      const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
      const batchDoc = await erpnextGetDoc<{ custom_pallet_weight?: number; custom_pallet_dims?: string }>(
        'Batch',
        printBatch
      ).catch(() => null)
      const zpl = buildPalletZpl({
        itemCode,
        itemName: item.item_name ?? itemCode,
        qty: target,
        uom: item.stock_uom ?? 'pcs',
        batch: printBatch,
        weight: batchDoc?.custom_pallet_weight ? `${batchDoc.custom_pallet_weight} lb` : undefined,
        dimensions: batchDoc?.custom_pallet_dims || undefined,
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
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
