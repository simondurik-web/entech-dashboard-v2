import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { getBatchLocation, assertBatchItem, reserveNextSerial, reissuePallet, verifyReissue, palletBase } from '@/lib/erpnext/inventory'
import { reservationsForBatches, releaseBatchReservation, reserveBatchesToSO } from '@/lib/erpnext/staging'
import { buildPalletZpl, labelTimestamp, brandForItemGroup } from '@/lib/erpnext/label'
import { resolveCustomerPartNo } from '@/lib/erpnext/customer-part'
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
      .select('idempotency_key, status, action, error')
      .eq('family', palletBase(batch))
      .in('status', ['pending', 'erp_committed', 'failed_pre_erp'])
      .neq('idempotency_key', idempotencyKey)
      .limit(1)
    if (inflight && inflight.length) {
      // Say WHY the pallet is held: a lingering FAILED op reads very differently
      // from a genuinely concurrent one (Abel's 5TJQ, 2026-07-08 — a failed
      // reprint held the family and every retry just said "in progress").
      const held = inflight[0]
      const msg = held.status === 'failed_pre_erp'
        ? `A previous ${held.action} on this pallet failed and is holding it (${(held.error ?? 'unknown error').slice(0, 160)}). Ask an admin to clear it from the ops log.`
        : 'Another operation is in progress for this pallet; try again shortly.'
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    target = loc.qty
    newBatch = await reserveNextSerial(batch)
  }

  // Whether this reprint RELEASED a reservation it then failed (or never got) to
  // re-bind to the new serial. Set inside erp(); read by the label step to tell
  // "transfer legitimately failed → honest SO-less label" apart from "transfer should
  // have happened but the live lookup can't see it → don't guess, go labelPending"
  // (codex/grok round-3). Both refs stay false on a resumed op that skips erp().
  const hadReservationRef = { current: false }
  const transferFailedRef = { current: false }
  // Set when a retry couldn't refresh an already-enqueued job's ZPL — the physical
  // label may not match the reservation-dependent content computed by this attempt.
  const labelMaybeStaleRef = { current: false }
  // Whether erp() executed in THIS request. When it didn't (erp_committed resume or a
  // done duplicate), the two refs above carry no knowledge and the staging outcome must
  // be recomputed fail-closed from live state instead (codex round-5 BLOCK).
  const erpRanRef = { current: false }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'reprint',
    createdBy: userId,
    meta: { item_code: itemCode, qty: target, station_id: station, batch, family: palletBase(batch), result_batch: newBatch },
    erp: async () => {
      erpRanRef.current = true
      // A staged (reserved) pallet keeps its reservation ACROSS a reprint: the
      // reservation moves to the new serial, so the order never shows a phantom
      // old code (Simon's SO-00013 report, 2026-07-03). Look up AND RELEASE
      // BEFORE the reissue — ERPNext v15 refuses to move reserved stock
      // (NegativeStockError; Abel's 5TJQ, 2026-07-08) — then re-reserve the new
      // serial best-effort after. A failed re-reserve just means the pallet
      // needs re-staging, which the release already made visible by recomputing
      // the SO's staging status.
      const reservation = (await reservationsForBatches([batch]).catch(() => ({} as Awaited<ReturnType<typeof reservationsForBatches>>)))[batch]
      if (reservation) {
        hadReservationRef.current = true
        await releaseBatchReservation(batch)
      }
      const committed = await reissuePallet({ oldBatch: batch, newBatch, itemCode, targetQty: target, opKey: idempotencyKey })
      if (reservation) {
        try {
          const loc = await getBatchLocation(newBatch, itemCode)
          if (loc && loc.qty > 0) {
            await reserveBatchesToSO({
              soName: reservation.so,
              items: [{ batch: newBatch, itemCode, warehouse: loc.warehouse, qty: loc.qty }],
            })
          } else {
            transferFailedRef.current = true
          }
        } catch (e) {
          transferFailedRef.current = true
          console.error(`reprint: reservation transfer ${batch} -> ${newBatch} failed:`, e)
        }
      }
      return committed
    },
    // reconcile is READ-ONLY: it only reports done if the reissue already completed, so it
    // is safe to call while a peer request may still be mutating. Incomplete -> null, and
    // the state machine re-runs erp() (reissuePallet) under its CAS claim.
    reconcile: () => verifyReissue({ oldBatch: batch, newBatch, itemCode, targetQty: target }),
    label: async (committed) => {
      const printBatch = committed.batch ?? newBatch
      const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string; item_group?: string }>(
        'Item',
        itemCode
      )
      const batchDoc = await erpnextGetDoc<{ custom_pallet_weight?: number; custom_pallet_dims?: string }>(
        'Batch',
        printBatch
      ).catch(() => null)
      // The reprinted label carries order info ONLY if the new serial holds a FULL
      // reservation right now (same invariant as add: SO on a label ⟺ attached for the
      // pallet's whole quantity — a partial bind must not produce an SO-labeled whole
      // pallet). Read AFTER the erp() transfer, so a failed transfer honestly prints
      // SO-less — and this is the recovery path for an attach-failed add: attach in
      // Prepare for staging, then Reprint yields a full label (DQ0N incident,
      // 2026-07-20). NO catch on the lookup: if we can't verify the attachment we must
      // not guess what the label should say — the throw lands in the op's labelPending
      // flow ("label pending — reprint"), whose retry is exactly the right recovery.
      const printReservation = (await reservationsForBatches([printBatch]))[printBatch]
      const fullyReserved = printReservation && printReservation.reservedQty + 1e-6 >= target
      if (hadReservationRef.current && !transferFailedRef.current && !fullyReserved) {
        // The transfer was made (no failure recorded) yet the live lookup can't see a
        // full reservation — could be a suppressed read inside the lookup. Don't guess
        // what the label should say; labelPending's retry re-reads and decides.
        throw new Error('reservation transfer to the new label is unverified — retry the reprint')
      }
      const customerPartNo = fullyReserved
        ? await resolveCustomerPartNo(itemCode, {
            salesOrder: printReservation.so,
            customer: printReservation.customer ?? undefined,
          }).catch(() => null)
        : null
      const zpl = buildPalletZpl({
        itemCode,
        itemName: item.item_name ?? itemCode,
        qty: target,
        uom: item.stock_uom ?? 'pcs',
        batch: printBatch,
        salesOrder: fullyReserved ? printReservation.so : undefined,
        customerPartNo: customerPartNo ?? undefined,
        customerPo: fullyReserved ? (printReservation.poNo ?? undefined) : undefined,
        weight: batchDoc?.custom_pallet_weight ? `${batchDoc.custom_pallet_weight} lb` : undefined,
        dimensions: batchDoc?.custom_pallet_dims || undefined,
        brand: brandForItemGroup(item.item_group),
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
      // Conflict (job already queued by a crashed attempt): the ZPL is now
      // reservation-dependent, so refresh a STILL-PENDING job to the freshly computed
      // content; if the job is already claimed/printed (or the update fails) flag the
      // label as possibly stale instead of silently returning it (codex round 4).
      const { data: refreshed, error: refreshErr } = await supabaseAdmin
        .from('print_jobs')
        .update({ zpl })
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .eq('status', 'pending')
        .select('id')
      if (refreshErr || (refreshed?.length ?? 0) === 0) labelMaybeStaleRef.current = true
      const { data: existing } = await supabaseAdmin.from('print_jobs').select('id').eq('idempotency_key', `print-${idempotencyKey}`).maybeSingle()
      return existing?.id ?? null
    },
  })

  if (result.status >= 200 && result.status < 300) {
    if (erpRanRef.current) {
      // erp() ran this request — the refs are exact knowledge. A released-but-not-
      // rebound reservation silently un-stages the pallet — say so; the client renders
      // staging.attached:false as a loud re-stage instruction (codex round-4 BLOCK;
      // previously only a server console.error).
      if (hadReservationRef.current && transferFailedRef.current) {
        result.body.staging = {
          attached: false,
          warning: 'The order reservation could not be moved to the new pallet code',
        }
      }
    } else {
      // erp() was skipped (erp_committed resume or done duplicate): the refs carry no
      // knowledge, so recompute FAIL-CLOSED from live state — a crash between reissue
      // and re-reserve must not come back green (codex round-5 BLOCK). A never-staged
      // pallet's replay also lands here; the wording is conditional for that reason.
      const finalBatch = (result.body?.batch as string | undefined) ?? newBatch
      try {
        const live = (await reservationsForBatches([finalBatch]))[finalBatch]
        if (!(live && live.reservedQty + 1e-6 >= target)) {
          result.body.staging = {
            attached: false,
            warning: `No full reservation is on ${finalBatch} — if this pallet was staged to an order, re-stage it in Prepare for staging`,
          }
        }
      } catch {
        result.body.staging = {
          attached: false,
          warning: `Could not verify the reservation on ${finalBatch} — check it in Prepare for staging`,
        }
      }
    }
    if (labelMaybeStaleRef.current) {
      result.body.labelPending = true
      result.body.labelMaybeStale = true
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}
