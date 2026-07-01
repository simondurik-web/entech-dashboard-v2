import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { reserveBatchesToSO } from '@/lib/erpnext/staging'
import { runInventoryOp } from '@/lib/erpnext/operation'

// POST /api/erpnext/staging/assign
// Reserve a set of scanned pallets (batches) to an open Sales Order in ERPNext.
// Body: { soName, pallets: [{ batch, itemCode, warehouse, qty }], idempotencyKey }.
// Idempotent via runInventoryOp: the op identity binds to the SO + the exact pallet set, so a
// double-tap or timeout-then-retry reuses the row instead of double-reserving. A reservation
// can't over-reserve a batch anyway (ERPNext caps at the stock's available-to-reserve qty), so
// a retry that re-runs is safe. family is null — this spans many pallets, outside the per-pallet
// lock, and it posts no Stock Entry.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Reserving each pallet is a sequential SBB-create + reservation call; give a big queue room.
export const maxDuration = 120

const MAX_PALLETS = 200

interface AssignBody {
  soName?: string
  pallets?: { batch?: string; itemCode?: string; warehouse?: string; qty?: number }[]
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AssignBody
  try {
    body = (await req.json()) as AssignBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const soName = body.soName?.trim()
  const idempotencyKey = body.idempotencyKey
  const rawPallets = Array.isArray(body.pallets) ? body.pallets : []
  if (!soName || !idempotencyKey || rawPallets.length === 0) {
    return NextResponse.json({ error: 'soName, pallets, and idempotencyKey are required' }, { status: 400 })
  }
  if (rawPallets.length > MAX_PALLETS) {
    return NextResponse.json({ error: `Too many pallets in one staging (max ${MAX_PALLETS})` }, { status: 400 })
  }

  const seen = new Set<string>()
  const pallets = rawPallets
    .map((p) => ({
      batch: (p.batch ?? '').trim(),
      itemCode: (p.itemCode ?? '').trim(),
      warehouse: (p.warehouse ?? '').trim(),
      qty: Number(p.qty),
    }))
    .filter((p) => p.batch && p.itemCode && p.warehouse && Number.isFinite(p.qty) && p.qty > 0)
    // De-dupe by batch: a batch can only be reserved once per request.
    .filter((p) => !seen.has(p.batch) && (seen.add(p.batch), true))
  if (pallets.length === 0) {
    return NextResponse.json({ error: 'No valid pallet lines' }, { status: 400 })
  }

  const userId = guard.userId
  // Bind the op identity to SO + the exact (sorted, de-duped) pallet set, so reusing the key
  // with a different SO/pallet set is rejected rather than run against the wrong reservation.
  const fingerprint = JSON.stringify({ so: soName, batches: [...new Set(pallets.map((p) => p.batch))].sort() })

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'stage-reserve',
    createdBy: userId,
    // family null: spans many pallets, no Stock Entry, so it sits outside the per-pallet lock.
    meta: { warehouse: soName, qty: pallets.length, item_code: fingerprint, batch: null, family: null },
    erp: () => reserveBatchesToSO({ soName, items: pallets }),
  })

  return NextResponse.json(result.body, { status: result.status })
}
