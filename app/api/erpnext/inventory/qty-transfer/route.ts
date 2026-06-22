import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { qtyTransfer, reconcileStockEntry } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'

// POST /api/erpnext/inventory/qty-transfer — move a quantity of a NON-serialized item
// from one bin to another (Material Transfer, no batch). For the fixed-pack products that
// aren't serialized. Idempotent via runInventoryOp + the [op:key] stamp.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000

interface Body {
  itemCode?: string
  qty?: number
  fromWarehouse?: string
  toWarehouse?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { itemCode, fromWarehouse, toWarehouse, idempotencyKey } = body
  const qty = Number(body.qty)
  // Boxes are whole units — require a positive integer.
  if (!itemCode || !fromWarehouse || !toWarehouse || !idempotencyKey || !Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) {
    return NextResponse.json(
      { error: 'itemCode, a whole-number qty (1..10M), fromWarehouse, toWarehouse, and idempotencyKey are required' },
      { status: 400 }
    )
  }
  if (fromWarehouse === toWarehouse) {
    return NextResponse.json({ error: 'Source and destination bins are the same' }, { status: 400 })
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'qty-transfer',
    createdBy: guard.userId,
    // No batch/family (non-serialized). family null keeps it outside the per-pallet lock.
    // Bind BOTH bins into the identity (warehouse = "from>to") so reusing a key with a
    // different source can't be mistaken for a duplicate of a prior move. qty-transfer rows
    // carry no label/history, so the composite value is never surfaced anywhere.
    meta: { item_code: itemCode, qty, warehouse: `${fromWarehouse}>${toWarehouse}`, batch: null, family: null },
    erp: () => qtyTransfer({ itemCode, qty, fromWarehouse, toWarehouse, opKey: idempotencyKey }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { stockEntry: se } : null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
