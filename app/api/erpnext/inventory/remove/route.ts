import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { removeInventory, reconcileStockEntry, palletBase, assertBatchItem, getBatchLocation } from '@/lib/erpnext/inventory'
import { snapshotAndRelease, restoreReservation } from '@/lib/erpnext/staged-pallet-op'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/remove
// Remove a pallet from stock (issue out remaining qty + disable the batch).
// Office-only. Reason is optional (recorded when given). Cancel-not-hard-delete: the
// stock ledger keeps the record.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OFFICE_ROLES = new Set(['admin', 'super_admin', 'manager', 'shipping_manager', 'advanced_user', 'shipping_team'])

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
    // Friendly pre-check (the partial unique index on `family` is the atomic
    // guarantee) — and say WHY the pallet is held: a lingering FAILED op reads
    // very differently from a genuinely concurrent one (Abel's 5TJQ, 2026-07-08:
    // a failed reprint held the family and delete attempts just said "in progress").
    const { data: inflight } = await supabaseAdmin
      .from('inventory_ops_log')
      .select('idempotency_key')
      .eq('family', palletBase(batch))
      .in('status', ['pending', 'erp_committed'])
      .neq('idempotency_key', idempotencyKey)
      .limit(1)
    if (inflight && inflight.length) {
      // Only genuinely ACTIVE ops block. A failed_pre_erp holder is intentionally NOT in
      // the filter above: it's a dead op (ERP never committed) and runInventoryOp
      // supersedes it atomically on the next attempt — before 2026-07-14 it jammed the
      // family forever ("ask an admin to clear it": Joseles's 4JA5 + 10 more pallets).
      return NextResponse.json({ error: 'Another operation is in progress for this pallet; try again shortly.' }, { status: 409 })
    }
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'remove',
    createdBy: userId,
    meta: { item_code: itemCode, batch, family: palletBase(batch) },
    erp: async () => {
      // A staged pallet's reservation must die WITH the pallet — otherwise the sales order
      // keeps listing a phantom pallet and its coverage math stays inflated (Simon found
      // SO-00013 showing deleted pallets, 2026-07-03).
      // Record it before cancelling, though: if the ISSUE-OUT then fails, the pallet still
      // exists but is no longer staged, and the op ends "ERP-clean" (no Stock Entry) — so a
      // later op would supersede this row and the Sales Order link would be lost silently.
      // The snapshot lets us put it straight back. No finalize() on success: the pallet is
      // meant to be gone, and re-staging a removed pallet is exactly what we don't want.
      await snapshotAndRelease(idempotencyKey, batch, itemCode)
      try {
        const r = await removeInventory({ batch, itemCode, reason, opKey: idempotencyKey })
        return { batch: r.batch, stockEntry: r.stockEntry }
      } catch (e) {
        await restoreReservation(idempotencyKey, batch, itemCode).catch(() => undefined)
        throw e
      }
    },
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
