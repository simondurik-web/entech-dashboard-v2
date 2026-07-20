import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { reserveNextSerial, reissuePallet, verifyReissue, removeInventory, reconcileStockEntry, assertBatchItem, getBatchLocation, palletBase } from '@/lib/erpnext/inventory'
import { reservationsForBatches, releaseBatchReservation, reserveBatchesToSO } from '@/lib/erpnext/staging'
import { buildPalletZpl, labelTimestamp } from '@/lib/erpnext/label'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { dashboardLinesForSoItems } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/adjust — change a pallet's qty, SERIALIZED.
// A qty change REISSUES the pallet as the next serial at the new qty and disables the
// old (so the old "100" label can't still be used after you change it to 50). Setting
// qty to 0 is treated as a soft Remove instead. Logged + idempotent (serial reused on
// retry; Repack/Issue reconciles by op key).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000
// Adjust-to-0 IS a removal — same office-only policy as the remove route
// (bug-hunt 2026-07-04: the pencil is visible to all inventory users, so a
// qty of 0 bypassed the office gate the trash button enforces).
const OFFICE_ROLES = new Set(['admin', 'super_admin', 'manager', 'shipping_manager', 'advanced_user', 'shipping_team'])

interface AdjustBody {
  batch?: string
  itemCode?: string
  newQty?: number
  station?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AdjustBody
  try {
    body = (await req.json()) as AdjustBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, station, idempotencyKey } = body
  const newQty = Number(body.newQty)
  if (!batch || !itemCode || !Number.isFinite(newQty) || newQty < 0 || newQty > MAX_QTY || !station || !idempotencyKey) {
    return NextResponse.json({ error: 'batch, itemCode, newQty (0..10M), station, and idempotencyKey are required' }, { status: 400 })
  }

  const { data: stationRow } = await supabaseAdmin
    .from('print_stations')
    .select('id')
    .eq('id', station)
    .eq('enabled', true)
    .single()
  if (!stationRow) {
    return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
  }
  if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
    return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
  }

  const userId = guard.userId
  const printedBy = await resolveUserName(userId)

  // Retry detection: if this op already started, skip the old-batch validation (the old
  // batch may already be empty/disabled) and reuse the reserved serial.
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('result_batch, qty')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  const isRetry = !!priorOp
  // Pin the target qty to the FIRST intent: a same-key retry with a different newQty
  // (double-submit of an edited form) must still reissue to the originally-logged qty.
  const target = isRetry ? Number(priorOp?.qty) : newQty

  if (!isRetry) {
    try {
      await assertBatchItem(batch, itemCode)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
    const loc = await getBatchLocation(batch, itemCode)
    // Deterministic preflight BEFORE the locked op row exists, for BOTH branches (a reissue
    // and the qty-0 soft-remove): a split pallet can't be reissued OR cleanly removed, so
    // reject it as a 400 here rather than letting reissuePallet/removeInventory throw after
    // the insert (which would leave the family locked in failed_pre_erp).
    if (loc?.split) {
      return NextResponse.json({ error: `Pallet ${batch} is split across multiple bins; consolidate in ERPNext first.` }, { status: 400 })
    }
    // A reissue to a non-zero qty needs the pallet's current bin to know where to repack;
    // an empty pallet has none. (Setting qty to 0 is the soft-remove branch below.)
    if (target > 0) {
      if (!loc || loc.qty <= 0) {
        return NextResponse.json({ error: `Pallet ${batch} has no stock; add a new pallet instead of adjusting.` }, { status: 400 })
      }
      // No-op: adjusting to the qty it already holds would needlessly burn a serial and
      // reprint. Tell the caller nothing changed (Reprint is the way to re-issue a label).
      if (loc.qty === target) {
        return NextResponse.json({ ok: true, batch, qty: target, unchanged: true }, { status: 200 })
      }
    }
    // Friendly pre-check (the partial unique index on `family` is the atomic guarantee):
    // reject if any serial in this pallet's family already has an active op.
    const { data: inflight } = await supabaseAdmin
      .from('inventory_ops_log')
      .select('idempotency_key, status, action, error')
      .eq('family', palletBase(batch))
      .in('status', ['pending', 'erp_committed', 'failed_pre_erp'])
      .neq('idempotency_key', idempotencyKey)
      .limit(1)
    if (inflight && inflight.length) {
      // Say WHY the pallet is held: a lingering FAILED op reads very differently
      // from a genuinely concurrent one (Abel's 5TJQ, 2026-07-08 — a failed
      // reprint held the family and every retry just said "in progress").
      const held = inflight[0]
      const msg = held.status === 'failed_pre_erp'
        ? `A previous ${held.action} on this pallet failed and is holding it (${(held.error ?? 'unknown error').slice(0, 160)}). Ask an admin to clear it from the ops log.`
        : 'Another operation is in progress for this pallet; try again shortly.'
      return NextResponse.json({ error: msg }, { status: 409 })
    }
  }

  // Qty 0 = soft remove (issue-out + disable), no reissue, no label. Branch on the PINNED
  // target (not the raw request) so a same-key retry can't divert an adjust-to-50 into a
  // remove just because a buggy retry sent newQty:0.
  if (target === 0) {
    if (!OFFICE_ROLES.has(guard.role)) {
      return NextResponse.json({ error: 'Setting a pallet to 0 removes it — office-only. Ask a supervisor.' }, { status: 403 })
    }
    const result = await runInventoryOp({
      key: idempotencyKey,
      action: 'remove',
      createdBy: userId,
      meta: { item_code: itemCode, qty: 0, station_id: station, batch, family: palletBase(batch) },
      erp: async () => {
        // Same rule as the remove route: a staged pallet's reservation dies
        // WITH the pallet, or the order keeps a phantom (bug-hunt 2026-07-04).
        await releaseBatchReservation(batch)
        return removeInventory({ batch, itemCode, reason: 'adjusted to 0', opKey: idempotencyKey })
      },
      reconcile: async () => {
        const se = await reconcileStockEntry(idempotencyKey)
        return se ? { batch, stockEntry: se } : null
      },
    })
    return NextResponse.json(result.body, { status: result.status })
  }

  // Reserve the new serial once; reuse on retry.
  const newBatch: string = priorOp?.result_batch ?? (await reserveNextSerial(batch))

  // Whether erp() saw a reservation on the pallet — the label step fails CLOSED
  // (throws into labelPending) when it can't verify the post-transfer state of a
  // pallet KNOWN to be staged, instead of quietly printing a bare label that
  // loses the SO/line off the physical pallet (codex round-6).
  const hadReservationRef = { current: false }
  // Whether erp() ran in THIS request — on an erp_committed resume it didn't,
  // hadReservationRef carries no knowledge, and a lookup failure must still
  // fail closed rather than print bare (codex round-8, mirrors reprint).
  const erpRanRef = { current: false }
  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'adjust',
    createdBy: userId,
    meta: { item_code: itemCode, qty: target, station_id: station, batch, family: palletBase(batch), result_batch: newBatch },
    erp: async () => {
      // A staged pallet's reservation moves to the new serial across a qty
      // change, capped at the NEW qty — same rule as the reprint route
      // (bug-hunt 2026-07-04: adjust reissued via the identical engine but
      // stranded the reservation on the drained old serial).
      erpRanRef.current = true
      const reservation = (await reservationsForBatches([batch]).catch(() => ({} as Awaited<ReturnType<typeof reservationsForBatches>>)))[batch]
      if (reservation) hadReservationRef.current = true
      const committed = await reissuePallet({ oldBatch: batch, newBatch, itemCode, targetQty: target, opKey: idempotencyKey })
      if (reservation) {
        try {
          // Pin the release to the snapshotted SRE — a concurrent reassignment
          // between the snapshot and here must not be cancelled (codex round-9).
          await releaseBatchReservation(batch, reservation.sre)
          const loc = await getBatchLocation(newBatch, itemCode)
          if (loc && loc.qty > 0) {
            await reserveBatchesToSO({
              soName: reservation.so,
              // Pin the transfer to the ORIGINAL release line — auto-allocation
              // is soonest-due and could rebind the adjusted pallet to a
              // different release (grok/codex review, 2026-07-20).
              items: [
                {
                  batch: newBatch,
                  itemCode,
                  warehouse: loc.warehouse,
                  qty: loc.qty,
                  salesOrderItem: reservation.soItem ?? undefined,
                },
              ],
            })
          }
        } catch (e) {
          console.error(`adjust: reservation transfer ${batch} -> ${newBatch} failed:`, e)
          return { ...committed, extra: { ...committed.extra, warning: 'reservation_transfer_failed' } }
        }
      }
      return committed
    },
    // reconcile is READ-ONLY (see reprint route): reports done only if already complete,
    // else null and the state machine re-runs erp() (reissuePallet) under its CAS claim.
    reconcile: () => verifyReissue({ oldBatch: batch, newBatch, itemCode, targetQty: target }),
    label: async (committed) => {
      const printBatch = committed.batch ?? newBatch
      const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
      // An adjusted STAGED pallet keeps its order across the reissue — the
      // replacement label must carry the SO + release line the floor stages by,
      // not print bare (codex round-5). Same invariant as reprint: order info
      // only with a FULL live reservation; lookup failure prints bare (the op
      // separately warns reservation_transfer_failed).
      let printLookupFailed = false
      const printReservation = (
        await reservationsForBatches([printBatch]).catch(() => {
          printLookupFailed = true
          return {} as Awaited<ReturnType<typeof reservationsForBatches>>
        })
      )[printBatch]
      if (printLookupFailed && (hadReservationRef.current || !erpRanRef.current)) {
        // Known-staged pallet — or a resumed op with no knowledge either way —
        // whose live state can't be read: don't guess what the label should
        // say; labelPending's retry re-reads and decides.
        throw new Error('reservation state unverifiable for the adjusted label — reprint required')
      }
      const fullyReserved = !!printReservation && printReservation.reservedQty + 1e-6 >= target
      const printLineNo =
        fullyReserved && printReservation.soItem
          ? (await dashboardLinesForSoItems([printReservation.soItem]))[printReservation.soItem]
          : undefined
      const zpl = buildPalletZpl({
        itemCode,
        itemName: item.item_name ?? itemCode,
        qty: target,
        uom: item.stock_uom ?? 'pcs',
        batch: printBatch,
        salesOrder: fullyReserved ? printReservation.so : undefined,
        lineNo: printLineNo != null ? String(printLineNo) : undefined,
        generatedAt: labelTimestamp(),
        printedBy,
      })
      const { data: job, error } = await supabaseAdmin
        .from('print_jobs')
        .upsert(
          {
            station_id: station,
            zpl,
            item_code: itemCode,
            batch: printBatch,
            created_by: userId,
            idempotency_key: `print-${idempotencyKey}`,
            status: 'pending',
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (job?.id) return job.id
      const { data: existing } = await supabaseAdmin
        .from('print_jobs')
        .select('id')
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .maybeSingle()
      return existing?.id ?? null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
