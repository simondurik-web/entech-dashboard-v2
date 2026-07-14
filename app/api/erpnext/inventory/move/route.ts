import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { transferInventory, transferPreflight, reconcileStockEntry, palletBase } from '@/lib/erpnext/inventory'
import { snapshotAndRelease, restoreReservation } from '@/lib/erpnext/staged-pallet-op'
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
  // warehouse / split / no-stock returns 400 here instead of throwing inside erp() (which
  // would leave the family locked in failed_pre_erp). Skipped on retry (the row exists and
  // runInventoryOp resumes/reconciles).
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('idempotency_key')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
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
    erp: async () => {
      // A staged pallet keeps its reservation ACROSS a bin move — relocating a pallet does
      // not change which order it belongs to. But an SRE pins the batch to its warehouse,
      // so ERPNext v15 refuses to move reserved stock (NegativeStockError: E2ZA/H8MF/7ZBE
      // Jul 4–8, QGSJ/36ZH Jul 14 — five jammed pallets, all staged). Release first,
      // recording the reservation on the op row so ANY later attempt can put it back; the
      // re-reserve itself happens in finalize(), which — unlike erp() — also runs when a
      // retry resumes an already-committed op.
      try {
        // Inside the try: snapshotAndRelease cancels the SRE and then does its own SO
        // bookkeeping, which can itself fail — leaving the pallet un-staged with no restore
        // attempted if this sat outside. (codex BLOCKER.)
        await snapshotAndRelease(idempotencyKey, batch, itemCode)
        return await transferInventory({ batch, itemCode, toWarehouse, opKey: idempotencyKey })
      } catch (e) {
        // Put back what we un-staged. If the restore reports the pallet is no longer backing
        // its order (e.g. the transfer did commit and then timed out), say so IN the error —
        // a generic failure would hide it and the order would ship short.
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
    // Re-stage the pallet at whatever bin it now occupies. Runs on a fresh commit AND on a
    // resumed one, reading the SO from the op row — so a retry that skips erp() still
    // re-reserves instead of silently leaving the pallet off its order.
    finalize: () => restoreReservation(idempotencyKey, batch, itemCode),
    // Proof required before superseding a dead op that holds this pallet family:
    // did ERP commit any stock document under THAT op's key? (see runInventoryOp)
    erpTouchedKey: (k) => reconcileStockEntry(k).then(Boolean),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
