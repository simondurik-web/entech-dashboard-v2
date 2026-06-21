import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { removeInventory, reconcileStockEntry } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'

// POST /api/erpnext/inventory/remove
// Remove a pallet from stock (issue out remaining qty + disable the batch).
// Office-only, requires a reason. Cancel-not-hard-delete: the stock ledger keeps
// the record.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OFFICE_ROLES = new Set(['admin', 'super_admin', 'manager', 'shipping_manager'])

interface RemoveBody {
  batch?: string
  itemCode?: string
  reason?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res
  if (!OFFICE_ROLES.has(guard.role)) {
    return NextResponse.json({ error: 'Removing a pallet is office-only' }, { status: 403 })
  }

  let body: RemoveBody
  try {
    body = (await req.json()) as RemoveBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, reason, idempotencyKey } = body
  if (!batch || !itemCode || !reason?.trim() || !idempotencyKey) {
    return NextResponse.json(
      { error: 'batch, itemCode, reason, and idempotencyKey are required' },
      { status: 400 }
    )
  }
  const userId = req.headers.get('x-user-id')

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'remove',
    createdBy: userId,
    meta: { item_code: itemCode, batch },
    erp: async () => {
      const r = await removeInventory({ batch, itemCode, reason: reason.trim(), opKey: idempotencyKey })
      return { batch: r.batch, stockEntry: r.stockEntry }
    },
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
