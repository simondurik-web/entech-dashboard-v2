import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { bulkTransfer, reconcileStockEntry } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'
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
  const fingerprint = [...new Set(lines.map((l) => l.batch))].sort().join(',')

  const result = await runInventoryOp({
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

  // Persist the ACTUAL moved count (meta.qty was the queued count) so the "last transfer"
  // line and any later lookup reflect what really moved, not what was queued.
  if (result.status === 200 && typeof result.body.moved === 'number') {
    await supabaseAdmin
      .from('inventory_ops_log')
      .update({ qty: result.body.moved })
      .eq('idempotency_key', idempotencyKey)
      .then(undefined, () => undefined)
  }

  return NextResponse.json(result.body, { status: result.status })
}
