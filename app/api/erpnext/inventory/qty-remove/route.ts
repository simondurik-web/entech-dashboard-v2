import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { qtyRemove, reconcileStockEntry } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'

// POST /api/erpnext/inventory/qty-remove — issue a quantity of a NON-serialized item out
// of a bin (Material Issue, no batch) for damage / internal use. Order-based shipping stays
// in ERPNext (Sales Order fulfillment). Reason is optional. Idempotent via runInventoryOp.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000

interface Body {
  itemCode?: string
  qty?: number
  warehouse?: string
  reason?: string
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
  const { itemCode, warehouse, idempotencyKey } = body
  const reason = (body.reason ?? '').trim()
  const qty = Number(body.qty)
  if (!itemCode || !warehouse || !idempotencyKey || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
    return NextResponse.json(
      { error: 'itemCode, qty (1..10M), warehouse, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'qty-remove',
    createdBy: guard.userId,
    meta: { item_code: itemCode, qty, warehouse, batch: null, family: null },
    erp: () => qtyRemove({ itemCode, qty, warehouse, reason, opKey: idempotencyKey }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { stockEntry: se } : null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
