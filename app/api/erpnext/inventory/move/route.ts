import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import {
  transferInventory,
  transferPreflight,
  reconcileStockEntry,
  palletBase,
  verifyOrRestoreMovedReservation,
} from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/move — transfer a pallet to a different bin.
// No label reprint: the bin/location is deliberately not printed on the label.
// Logged as action 'move' (with the destination warehouse + user) so it shows in
// the pallet's history.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MoveBody {
  batch?: string
  itemCode?: string
  toWarehouse?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: MoveBody
  try {
    body = (await req.json()) as MoveBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, toWarehouse, idempotencyKey } = body
  if (!batch || !itemCode || !toWarehouse || !idempotencyKey) {
    return NextResponse.json(
      { error: 'batch, itemCode, toWarehouse, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  const userId = guard.userId // verified from the session, not a client header

  // Deterministic preflight on the FIRST attempt, BEFORE the locked op row exists: bad
  // warehouse / split / no-stock / uncarryable reservation returns 400 here instead of
  // throwing inside erp() (which would leave the family locked in failed_pre_erp).
  // Skipped on retry (the row exists and runInventoryOp resumes/reconciles). A FAILED
  // lookup is a hard 503 — treating it as "no prior op" would rerun preflight against a
  // mid-carry pallet (whose reservation this op already released) and 400 the retry.
  const { data: priorOp, error: priorErr } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('idempotency_key, batch, error')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (priorErr) {
    return NextResponse.json({ error: 'Operation log unavailable; try again shortly.' }, { status: 503 })
  }
  // Operation identity binds to the FAMILY, not the batch — but reservation
  // verification below acts on the REQUEST's batch. A replayed key must reference the
  // same pallet, or an old op's stamped intent could be applied to a different serial
  // in the family (review r7).
  if (priorOp && priorOp.batch && priorOp.batch !== batch) {
    return NextResponse.json({ error: 'This idempotency key was already used for a different pallet.' }, { status: 409 })
  }
  let preflightReserved = false
  if (!priorOp) {
    try {
      preflightReserved = (await transferPreflight(batch, itemCode, toWarehouse)).reserved
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  // NOTE (r15): there is deliberately NO stale-pending reclaim here. A crash mid-erp()
  // leaves the row 'pending' and the family 409s until an admin clears it — the SAME
  // operational model as every other inventory op (add/adjust/reprint). Every reclaim
  // design reviewed (r9-r15) had an unprovable liveness assumption (no serverless
  // maxDuration off-Vercel, no heartbeat); the born 'reservation:' checkpoint plus the
  // armed draft keep the carry fully recoverable when the admin unwedges the row to
  // failed_pre_erp, after which the runner re-runs erp() under its own claim.

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'move',
    createdBy: userId,
    // Reserved-pallet moves are BORN with the 'reservation:' checkpoint (spread into
    // the insert row via meta): the durable marker exists before any mutating step, so
    // no crash window can leave a carried reservation untracked (r11). Cleared below
    // once the carry is verified.
    meta: {
      item_code: itemCode,
      warehouse: toWarehouse,
      batch,
      family: palletBase(batch),
      ...(preflightReserved ? { error: 'reservation: carrying' } : {}),
    },
    erp: () =>
      transferInventory({
        batch,
        itemCode,
        toWarehouse,
        opKey: idempotencyKey,
        // Arm the durable checkpoint the moment a carry is CONFIRMED inside erp() —
        // covers a reservation that appeared after the preflight snapshot (r14).
        onCarryStart: async () => {
          await supabaseAdmin
            .from('inventory_ops_log')
            .update({ error: 'reservation: carrying' })
            .eq('idempotency_key', idempotencyKey)
            .eq('status', 'pending')
            .is('error', null)
        },
      }),
    // Reconcile is strictly READ-ONLY (r9): it may only recognize an already-submitted
    // entry. All mutating recovery lives in erp(), which runs under the CAS claim.
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
  })

  // EVERY successful response is reservation-verified before it leaves — resumed rows
  // (duplicate replays, erp_committed checkpoints, pending reconciles) reproduce only
  // the core body, so a lost reservation could otherwise replay as a clean success
  // (review r3, all legs). verifyOrRestoreMovedReservation is bound to this op's own
  // stamped Stock Entry: for a never-reserved move it answers null from one lookup, and
  // when the carry was interrupted it restores (or warns loudly). A fresh erp() WARNING
  // is also re-verified (r4): the second attempt often restores immediately — and a
  // reservation that actually bound despite a bookkeeping throw must not read as lost.
  if (result.status === 200) {
    const body = result.body as Record<string, unknown>
    // Restores (and arming the restore checkpoint) are allowed when THIS request
    // advanced the operation — a fresh run, or a resume that isn't a pure 'done'
    // replay — or when the op row already records an unresolved reservation
    // ('reservation:' checkpoint). A pure done-replay with a clean row is
    // verify-ONLY, and its observations must NOT arm the checkpoint: an operator's
    // deliberate later release would otherwise be resurrected by the next replay
    // (review r7/r8, both directions).
    const allowRestore =
      !priorOp || body.duplicate !== true || String(priorOp.error ?? '').startsWith('reservation:')
    if (body.reservedTo === undefined) {
      const follow = await verifyOrRestoreMovedReservation({
        batch,
        itemCode,
        toWarehouse,
        opKey: idempotencyKey,
        allowRestore,
      })
      if (follow) {
        if (follow.reservedTo !== undefined) {
          // Verified (or restored) — drop any stale lost-reservation warning.
          delete body.warning
          delete body.reservationLostFrom
        }
        result.body = { ...body, ...follow }
      }
    }
    // ORPHANED-CHECKPOINT SWEEP (r9, made VERIFY-ONLY in r10): the browser's key is
    // volatile — a reload after a reservation-lost warning mints a NEW key that knows
    // nothing about the older op's unresolved carry, so unresolved checkpoints are
    // discoverable by PALLET FAMILY. But the sweep NEVER writes ERP state (auto-restore
    // here would resurrect deliberately released reservations and undo the r7/r8
    // protections — r10, both legs). It only (a) clears checkpoints that resolved
    // themselves (pallet reserved again, or nothing recoverable on the stamp) and
    // (b) surfaces a LOUD standalone nag telling the floor to re-stage. The nag is a
    // separate field: it must not read as THIS move failing, must not keep the retry
    // key, and must never arm a checkpoint on this op's own row.
    const bodyAfter = result.body as Record<string, unknown>
    if (!priorOp && bodyAfter.reservedTo === undefined && bodyAfter.warning === undefined) {
      const { data: orphans } = await supabaseAdmin
        .from('inventory_ops_log')
        .select('idempotency_key')
        .eq('family', palletBase(batch))
        .eq('action', 'move')
        // EXACT batch: family-wide matching could verify/clear against a different
        // serial after a reissue (r15). A reissued pallet's orphaned checkpoint is
        // admin-visible in the ops log rather than auto-swept.
        .eq('batch', batch)
        .like('error', 'reservation:%')
        .neq('idempotency_key', idempotencyKey)
        .limit(1)
      const orphanKey = orphans?.[0]?.idempotency_key as string | undefined
      if (orphanKey) {
        const follow = await verifyOrRestoreMovedReservation({
          batch,
          itemCode,
          toWarehouse,
          opKey: orphanKey,
          allowRestore: false,
        })
        if (follow === null || follow.reservedTo !== undefined) {
          // Resolved (reserved again) or nothing recoverable — retire the checkpoint.
          const { error: clrErr } = await supabaseAdmin
            .from('inventory_ops_log')
            .update({ error: null })
            .eq('idempotency_key', orphanKey)
          if (clrErr) console.error('move: clearing orphaned reservation checkpoint failed:', clrErr)
        } else if (follow.warning === 'reservation_transfer_failed') {
          result.body = {
            ...bodyAfter,
            orphanedReservationFrom: follow.reservationLostFrom ?? true,
          }
        }
      }
    }

    // Persist the reservation outcome on the op row so REPLAYS know whether this op
    // still owes a restore. 'reservation:' in `error` is inert to the state machine
    // (it only ever parses the 'label:' prefix on done rows) and move ops have no
    // label phase. Best-effort but logged — a lost write degrades to verify-only on
    // replay. Never armed from verify-only observations (see allowRestore above).
    const finalBody = result.body as Record<string, unknown>
    if (finalBody.warning === 'reservation_transfer_failed' && allowRestore) {
      const { error: markErr } = await supabaseAdmin
        .from('inventory_ops_log')
        .update({ error: 'reservation: transfer_failed' })
        .eq('idempotency_key', idempotencyKey)
      if (markErr) console.error('move: persisting reservation checkpoint failed:', markErr)
    } else if (finalBody.reservedTo !== undefined) {
      // SQL-guarded clear: the LIKE predicate confines this to reservation checkpoints
      // regardless of when the row was armed (born, late via onCarryStart, or by a
      // warning) - no stale in-memory snapshot decides (r15).
      const { error: clearErr } = await supabaseAdmin
        .from('inventory_ops_log')
        .update({ error: null })
        .eq('idempotency_key', idempotencyKey)
        .like('error', 'reservation:%')
      if (clearErr) console.error('move: clearing reservation checkpoint failed:', clearErr)
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}
