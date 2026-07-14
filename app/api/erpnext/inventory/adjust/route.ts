import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { reserveNextSerial, reissuePallet, verifyReissue, removeInventory, reconcileStockEntry, assertBatchItem, getBatchLocation, palletBase } from '@/lib/erpnext/inventory'
import { snapshotAndRelease, restoreReservation } from '@/lib/erpnext/staged-pallet-op'
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
// Adjust-to-0 IS a removal — same office-only policy as the remove route
// (bug-hunt 2026-07-04: the pencil is visible to all inventory users, so a
// qty of 0 bypassed the office gate the trash button enforces).
const OFFICE_ROLES = new Set(['admin', 'super_admin', 'manager', 'shipping_manager', 'advanced_user', 'shipping_team'])

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
  if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
    return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
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
  }

  // Qty 0 = soft remove (issue-out + disable), no reissue, no label. Branch on the PINNED
  // target (not the raw request) so a same-key retry can't divert an adjust-to-50 into a
  // remove just because a buggy retry sent newQty:0.
  if (target === 0) {
    if (!OFFICE_ROLES.has(guard.role)) {
      return NextResponse.json({ error: 'Setting a pallet to 0 removes it — office-only. Ask a supervisor.' }, { status: 403 })
    }
    const result = await runInventoryOp({
      key: idempotencyKey,
      action: 'remove',
      createdBy: userId,
      meta: { item_code: itemCode, qty: 0, station_id: station, batch, family: palletBase(batch) },
      erp: async () => {
        // Same rule as the remove route: a staged pallet's reservation dies WITH the pallet,
        // or the order keeps a phantom (bug-hunt 2026-07-04). Snapshot it first so a removal
        // that fails AFTER the cancel can put the reservation back — otherwise the op looks
        // ERP-clean, gets superseded, and the pallet's order link is lost silently.
        try {
          await snapshotAndRelease(idempotencyKey, batch, itemCode)
          return await removeInventory({ batch, itemCode, reason: 'adjusted to 0', opKey: idempotencyKey })
        } catch (e) {
          const w = await restoreReservation(idempotencyKey, batch, itemCode, true).catch(() => 'reservation_transfer_failed')
          if (w) {
            throw new Error(
              `WARNING: pallet ${batch} may no longer be staged to its order; re-stage it before shipping. — ${(e as Error).message}`
            )
          }
          throw e
        }
      },
      // Same jam fix as every other family-locked op: a dead holder must be supersedable
      // here too, or adjust-to-0 (soft remove) stays stuck behind it.
      erpTouchedKey: (k) => reconcileStockEntry(k).then(Boolean),
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
    erp: async () => {
      // A staged pallet's reservation moves to the new serial across a qty
      // change, capped at the NEW qty — same rule as the reprint route
      // (bug-hunt 2026-07-04: adjust reissued via the identical engine but
      // stranded the reservation on the drained old serial).
      // Look up AND RELEASE **BEFORE** the reissue — ERPNext v15 refuses to issue
      // reserved stock (NegativeStockError). The reprint route got this order on
      // 2026-07-08 (Abel's 5TJQ) but adjust kept releasing AFTER reissuePallet, so
      // adjusting any fully-staged pallet failed and jammed it (Joseles's 4JA5,
      // 2026-07-10). On a retry the reservation is already gone — reservationsForBatches
      // returns nothing and the reissue just re-runs.
      // Record the reservation on the op row, THEN release — so any later attempt can put
      // it back even though this closure is long gone by then.
      try {
        // Inside the try: the release can fail mid-way (it cancels the SRE, then updates the
        // SO), which would otherwise leave the pallet un-staged with no restore attempted.
        await snapshotAndRelease(idempotencyKey, batch, itemCode)
        return await reissuePallet({ oldBatch: batch, newBatch, itemCode, targetQty: target, opKey: idempotencyKey })
      } catch (e) {
        // Restore what we un-staged; if the pallet is no longer backing its order, say so IN
        // the error rather than letting a generic failure hide it. (codex BLOCKER.)
        const w = await restoreReservation(idempotencyKey, batch, itemCode, true).catch(() => 'reservation_transfer_failed')
        if (w) {
          // Warning FIRST: the runner truncates the error to 200 chars for the response, and
          // an ERPNext message alone routinely exceeds that — appending buried it. (codex.)
          throw new Error(
            `WARNING: pallet ${batch} may no longer be staged to its order; re-stage it before shipping. — ${(e as Error).message}`
          )
        }
        throw e
      }
    },
    // The qty change reissues the pallet under a NEW serial, so the reservation follows the
    // stock there. Runs on fresh commits AND resumes — a retry that skips erp() must still
    // re-stage, or the pallet quietly leaves its order.
    finalize: (c) => restoreReservation(idempotencyKey, c.batch ?? newBatch, itemCode),
    // reconcile is READ-ONLY (see reprint route): reports done only if already complete,
    // else null and the state machine re-runs erp() (reissuePallet) under its CAS claim.
    // Proof required before superseding a dead op that holds this pallet family:
    // did ERP commit any stock document under THAT op's key? (see runInventoryOp)
    erpTouchedKey: (k) => reconcileStockEntry(k).then(Boolean),
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
