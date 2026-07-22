import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { bulkTransfer, reconcileStockEntry, palletBase } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { withLeases, LineLockedError } from '@/lib/erpnext/line-lock'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
  // RECOVERING-PALLET SKIP (r25): leases expire, but a crashed reserved move leaves an
  // ACTIVE op row / armed 'reservation:' checkpoint — bulk must not move such a pallet
  // (its recovery would later resume against a stale location/order).
  // Filter in SQL (status OR armed checkpoint) — an unfiltered scan silently truncates
  // at PostgREST's 1000-row cap and could drop a recovering row (grok r26). The
  // filtered result is tiny; a full page means something is deeply wrong — fail closed.
  const { data: busyRows, error: busyErr } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('batch')
    .eq('action', 'move')
    .in('batch', [...new Set(lines.map((l) => l.batch))])
    .or('status.in.(pending,failed_pre_erp,erp_committed),error.like.reservation:%')
    .limit(1000)
  if (busyErr || (busyRows ?? []).length >= 1000) {
    return NextResponse.json({ error: 'Operation log unavailable; try again shortly.' }, { status: 503 })
  }
  const recovering = new Set((busyRows ?? []).map((r) => String(r.batch)))
  const movable = lines.filter((l) => !recovering.has(l.batch))
  const recoveringSkips = lines
    .filter((l) => recovering.has(l.batch))
    .map((l) => ({ batch: l.batch, reason: 'recovering' }))
  if (movable.length === 0 && recoveringSkips.length > 0) {
    return NextResponse.json(
      { ok: true, stockEntry: null, moved: 0, skipped: recoveringSkips, destination },
      { status: 200 }
    )
  }
  let result: Awaited<ReturnType<typeof runInventoryOp>>
  try {
    const bulkStart = Date.now()
    result = await withLeases(
      [...new Set(movable.map((l) => `pallet:${palletBase(l.batch)}`))],
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
    erp: () =>
      bulkTransfer({
        destination,
        lines: movable,
        opKey: idempotencyKey,
        // Mutation must begin within 540s of the 600s lease (r28) — the per-pallet
        // location reads before the single atomic submit can be slow on big queues.
        deadlineMs: bulkStart + 540_000,
      }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { stockEntry: se } : null
    },
  })
    ,
      600
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

  if (result.status === 200 && recoveringSkips.length > 0) {
    const b = result.body as { skipped?: { batch: string; reason: string }[] }
    result.body = { ...result.body, skipped: [...(b.skipped ?? []), ...recoveringSkips] }
  }
  return NextResponse.json(result.body, { status: result.status })
}
