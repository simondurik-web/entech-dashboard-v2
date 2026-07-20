import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { removeInventory, reconcileStockEntry, palletBase, assertBatchItem, getBatchLocation } from '@/lib/erpnext/inventory'
import { releaseBatchReservation } from '@/lib/erpnext/staging'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { allowedStationIds } from '@/lib/erpnext/printer-access'
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
    // Delete follows PRINT permission: anyone granted at least one print
    // station (group leaders) can also delete labels — printing and fixing a
    // bad label are the same job (Simon 2026-07-20). Users with neither an
    // office role nor any printer stay locked out.
    const allowed = await allowedStationIds(guard.userId, guard.role)
    let canPrint = allowed === 'all'
    if (!canPrint && allowed.size > 0) {
      // The grant must point at an ENABLED station — a stale grant to a
      // decommissioned printer is not printing ability (codex review).
      const { data } = await supabaseAdmin
        .from('print_stations')
        .select('id')
        .eq('enabled', true)
        .in('id', [...allowed])
      canPrint = (data ?? []).length > 0
    }
    if (!canPrint) {
      return NextResponse.json({ error: 'Deleting a label requires label-printing access' }, { status: 403 })
    }
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
      .select('idempotency_key, status, action, error')
      .eq('family', palletBase(batch))
      .in('status', ['pending', 'erp_committed', 'failed_pre_erp'])
      .neq('idempotency_key', idempotencyKey)
      .limit(1)
    if (inflight && inflight.length) {
      const held = inflight[0]
      const msg = held.status === 'failed_pre_erp'
        ? `A previous ${held.action} on this pallet failed and is holding it (${(held.error ?? 'unknown error').slice(0, 160)}). Ask an admin to clear it from the ops log.`
        : 'Another operation is in progress for this pallet; try again shortly.'
      return NextResponse.json({ error: msg }, { status: 409 })
    }
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'remove',
    createdBy: userId,
    meta: { item_code: itemCode, batch, family: palletBase(batch) },
    erp: async () => {
      // A staged pallet's reservation must die WITH the pallet — otherwise the
      // sales order keeps listing a phantom pallet and its coverage math stays
      // inflated (Simon found SO-00013 showing deleted pallets, 2026-07-03).
      // releaseBatchReservation no-ops when there is none, and recomputes the
      // source SO's staging status when there is; retry-safe either way.
      await releaseBatchReservation(batch)
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
