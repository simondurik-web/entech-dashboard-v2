import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { bulkTransfer, reconcileStockEntry, palletBase } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { withLeases, LineLockedError } from '@/lib/erpnext/line-lock'

// POST /api/erpnext/inventory/bulk-transfer
// Move many pallets to one destination bin in a single atomic ERPNext Material Transfer.
// Body: { destination, lines: [{ batch, itemCode }], idempotencyKey }.
// Idempotent via runInventoryOp (the transfer is stamped [op:key]; a retry reconciles by
// finding that stock entry instead of posting again). Logged as action 'bulk-transfer'
// with family null (it spans many pallets, so it sits outside the per-pallet family lock;
// a move doesn't reissue serials, so that lock isn't needed here).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// A large queue resolves each pallet's location before building the transfer; give it room.
export const maxDuration = 120

const MAX_LINES = 200

interface BulkBody {
  destination?: string
  lines?: { batch?: string; itemCode?: string }[]
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: BulkBody
  try {
    body = (await req.json()) as BulkBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const destination = body.destination?.trim()
  const idempotencyKey = body.idempotencyKey
  const rawLines = Array.isArray(body.lines) ? body.lines : []
  if (!destination || !idempotencyKey || rawLines.length === 0) {
    return NextResponse.json({ error: 'destination, lines, and idempotencyKey are required' }, { status: 400 })
  }
  if (rawLines.length > MAX_LINES) {
    return NextResponse.json({ error: `Too many pallets in one transfer (max ${MAX_LINES})` }, { status: 400 })
  }
  const lines = rawLines
    .map((l) => ({ batch: (l.batch ?? '').trim(), itemCode: (l.itemCode ?? '').trim() }))
    .filter((l) => l.batch && l.itemCode)
  if (lines.length === 0) {
    return NextResponse.json({ error: 'No valid pallet lines' }, { status: 400 })
  }

  const userId = guard.userId
  // Bind the op identity to the exact pallet SET (sorted, de-duped). runInventoryOp's
  // retry guard compares meta.item_code, so reusing the same idempotency key with a
  // different pallet set is rejected rather than run against the wrong batches. (The
  // client already derives the key from dest+sorted-batches, so this is defense-in-depth.)
  // JSON-encode the sorted set (not a comma-join) so the binding is delimiter-safe.
  const fingerprint = JSON.stringify([...new Set(lines.map((l) => l.batch))].sort())

  // PALLET LEASES (r19): bulk holds the same per-pallet leases as the single move and
  // staging/assign — without them, a bulk queued during a reserved move's cancel-
  // before-submit window could see the pallet as unreserved and move it first.
  let result: Awaited<ReturnType<typeof runInventoryOp>>
  try {
    result = await withLeases(
      [...new Set(lines.map((l) => `pallet:${palletBase(l.batch)}`))],
      () =>
        runInventoryOp({
    key: idempotencyKey,
    action: 'bulk-transfer',
    createdBy: userId,
    // family null on purpose: a bulk move spans many pallets so it can't take the single
    // per-pallet family lock. A move doesn't reissue serials, so the serialization-critical
    // lock isn't needed; the worst a concurrent reissue/remove on a queued pallet can do is
    // make this transfer's atomic Stock Entry fail at submit (ERPNext rejects insufficient/
    // disabled-batch stock) — a clean failure to re-post, never a silent double-move.
    meta: { warehouse: destination, qty: lines.length, item_code: fingerprint },
    erp: () => bulkTransfer({ destination, lines, opKey: idempotencyKey }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { stockEntry: se } : null
    },
  })
    )
  } catch (e) {
    if (e instanceof LineLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    throw e
  }

  // NOTE: we deliberately do NOT overwrite inventory_ops_log.qty with the actual moved
  // count — qty is part of runInventoryOp's idempotency identity, so changing it would make
  // a legitimate retry of a partial transfer look like a "different operation" (false 409).
  // qty stays = the queued count; the "last transfer" line reflects that. In practice the
  // queue is pre-validated at scan time, so skips are near-zero and queued == moved. The
  // fresh-post response still returns the exact moved/skipped counts to the UI.

  return NextResponse.json(result.body, { status: result.status })
}
