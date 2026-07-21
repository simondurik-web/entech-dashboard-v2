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
  // lookup is a hard 503 — treating it as "no prior op" would drop the retry context
  // (sinceIso) that reservation recovery depends on.
  const { data: priorOp, error: priorErr } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('idempotency_key, created_at')
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
  // On a retry, the first attempt may have released the pallet's reservation and died
  // before restoring it — the cancelled-reservation trail is only searched from the op
  // row's creation onward, so a deliberate earlier release can never be "restored".
  const sinceIso: string | null = (priorOp?.created_at as string | undefined) ?? null

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'move',
    createdBy: userId,
    meta: { item_code: itemCode, warehouse: toWarehouse, batch, family: palletBase(batch) },
    erp: () => transferInventory({ batch, itemCode, toWarehouse, opKey: idempotencyKey, sinceIso }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      if (!se) return null
      // The stock entry committed on a previous attempt — make sure the reservation
      // survived (or restore it, bound to the [carried:...] stamp on that entry)
      // before reporting the op done; never silent-drop a staged pallet's SO binding
      // (review 2026-07-21).
      const follow = await verifyOrRestoreMovedReservation({ batch, itemCode, toWarehouse, stockEntry: se, sinceIso })
      return { batch, stockEntry: se, ...(follow ? { extra: follow } : {}) }
    },
  })

  // A 'done'-row replay (duplicate:true) reproduces only the core body — the original
  // response's reservation extras are not persisted. Re-derive them so a client that
  // lost the first response still learns whether the reservation survived (a lost
  // reservation must never replay as a clean success).
  if (result.status === 200 && (result.body as { duplicate?: boolean }).duplicate) {
    const se = (result.body as { stockEntry?: string | null }).stockEntry ?? null
    const follow = await verifyOrRestoreMovedReservation({ batch, itemCode, toWarehouse, stockEntry: se, sinceIso })
    if (follow) result.body = { ...result.body, ...follow }
  }

  return NextResponse.json(result.body, { status: result.status })
}
