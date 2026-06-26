import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { removeInventory, reconcileStockEntry, palletBase, assertBatchItem, getBatchLocation } from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/remove
// Remove a pallet from stock (issue out remaining qty + disable the batch).
// Office-only. Reason is optional (recorded when given). Cancel-not-hard-delete: the
// stock ledger keeps the record.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OFFICE_ROLES = new Set(['admin', 'super_admin', 'manager', 'shipping_manager', 'advanced_user'])

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
  const { batch, itemCode, idempotencyKey } = body
  // Reason is OPTIONAL — a blank reason still removes (faster); a typed one is recorded.
  const reason = (body.reason ?? '').trim()
  if (!batch || !itemCode || !idempotencyKey) {
    return NextResponse.json(
      { error: 'batch, itemCode, and idempotencyKey are required' },
      { status: 400 }
    )
  }
  const userId = guard.userId // verified from the session, not a client header

  // Deterministic preflight on the FIRST attempt, BEFORE the locked op row exists: a
  // batch/item mismatch or a split pallet returns 400 here rather than throwing inside
  // erp() (which would leave the family locked in failed_pre_erp). Skipped on retry.
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('idempotency_key')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (!priorOp) {
    try {
      await assertBatchItem(batch, itemCode, false)
      const loc = await getBatchLocation(batch, itemCode)
      if (loc?.split) {
        return NextResponse.json({ error: `Pallet ${batch} is split across multiple bins; consolidate in ERPNext first.` }, { status: 400 })
      }
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'remove',
    createdBy: userId,
    meta: { item_code: itemCode, batch, family: palletBase(batch) },
    erp: async () => {
      const r = await removeInventory({ batch, itemCode, reason, opKey: idempotencyKey })
      return { batch: r.batch, stockEntry: r.stockEntry }
    },
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
