import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import {
  transferInventory,
  transferPreflight,
  reconcileStockEntry,
  palletBase,
  verifyOrRestoreMovedReservation,
  resumeMoveDraft,
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
    .select('idempotency_key')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (priorErr) {
    return NextResponse.json({ error: 'Operation log unavailable; try again shortly.' }, { status: 503 })
  }
  if (!priorOp) {
    try {
      await transferPreflight(batch, itemCode, toWarehouse)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }
  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'move',
    createdBy: userId,
    meta: { item_code: itemCode, warehouse: toWarehouse, batch, family: palletBase(batch) },
    erp: () => transferInventory({ batch, itemCode, toWarehouse, opKey: idempotencyKey }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      if (se) return { batch, stockEntry: se }
      // No SUBMITTED entry — but a crash mid-carry leaves this op's stamped DRAFT and a
      // 'pending' row, from which the state machine never re-runs erp(). Complete the
      // interrupted carry here (validate stamped intent vs live reservation, release if
      // still held, submit the draft); the post-op verification below re-reserves.
      // Without this, the pallet family wedges AND the reservation stays lost (r4).
      const resumed = await resumeMoveDraft({ batch, itemCode, toWarehouse, opKey: idempotencyKey })
      return resumed ? { batch, stockEntry: resumed } : null
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
    if (body.reservedTo === undefined) {
      const follow = await verifyOrRestoreMovedReservation({ batch, itemCode, toWarehouse, opKey: idempotencyKey })
      if (follow) {
        if (follow.reservedTo !== undefined) {
          // Verified (or restored) — drop any stale lost-reservation warning.
          delete body.warning
          delete body.reservationLostFrom
        }
        result.body = { ...body, ...follow }
      }
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}
