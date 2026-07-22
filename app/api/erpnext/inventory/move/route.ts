import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import {
  transferInventory,
  transferPreflight,
  reconcileStockEntry,
  palletBase,
  verifyOrRestoreMovedReservation,
  moveLeaseSo,
} from '@/lib/erpnext/inventory'
import { runInventoryOp } from '@/lib/erpnext/operation'
import { withLeases, LineLockedError } from '@/lib/erpnext/line-lock'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/move — transfer a pallet to a different bin.
// No label reprint: the bin/location is deliberately not printed on the label.
// Logged as action 'move' (with the destination warehouse + user) so it shows in
// the pallet's history.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Below the 130s lease TTL, matching staging/assign — a request can never outlive its
// leases where the platform honors maxDuration (r17).
export const maxDuration = 120

interface MoveBody {
  batch?: string
  itemCode?: string
  toWarehouse?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: MoveBody
  try {
    body = (await req.json()) as MoveBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, toWarehouse, idempotencyKey } = body
  // Same shape rule runInventoryOp enforces — checked HERE too so no bracket/pipe
  // payload can ever reach a remark or a LIKE pattern through any pre-op read
  // (defense-in-depth; r20).
  if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) {
    return NextResponse.json({ error: 'invalid idempotencyKey' }, { status: 400 })
  }
  if (!batch || !itemCode || !toWarehouse || !idempotencyKey) {
    return NextResponse.json(
      { error: 'batch, itemCode, toWarehouse, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  const userId = guard.userId // verified from the session, not a client header
  const routeStart = Date.now()
  // 'reservation: unverified' (a fail-closed marker written when the ops-log could not
  // be READ) warns and nags but never grants restore authority (r23).
  const markerAuthorizes = (err: unknown) => {
    const e = String(err ?? '')
    return e.startsWith('reservation:') && !e.startsWith('reservation: unverified')
  }
  // Arming that happens DURING this request (onCarryStart) — tracked locally so an
  // immediate in-request recovery isn't denied by stale preflight snapshots (r23).
  let armedThisRequest = false

  // Deterministic preflight on the FIRST attempt, BEFORE the locked op row exists: bad
  // warehouse / split / no-stock / uncarryable reservation returns 400 here instead of
  // throwing inside erp() (which would leave the family locked in failed_pre_erp).
  // Skipped on retry (the row exists and runInventoryOp resumes/reconciles). A FAILED
  // lookup is a hard 503 — treating it as "no prior op" would rerun preflight against a
  // mid-carry pallet (whose reservation this op already released) and 400 the retry.
  const { data: priorOp, error: priorErr } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('idempotency_key, batch, error')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (priorErr) {
    return NextResponse.json({ error: 'Operation log unavailable; try again shortly.' }, { status: 503 })
  }
  // Operation identity binds to the FAMILY, not the batch — but reservation
  // verification below acts on the REQUEST's batch. A replayed key must reference the
  // same pallet, or an old op's stamped intent could be applied to a different serial
  // in the family (review r7).
  if (priorOp && priorOp.batch && priorOp.batch !== batch) {
    return NextResponse.json({ error: 'This idempotency key was already used for a different pallet.' }, { status: 409 })
  }
  let preflightReserved = false
  let preflightSo: string | null = null
  if (!priorOp) {
    try {
      const pf = await transferPreflight(batch, itemCode, toWarehouse)
      preflightReserved = pf.reserved
      preflightSo = pf.so
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  // NOTE (r15): there is deliberately NO stale-pending reclaim here. A crash mid-erp()
  // leaves the row 'pending' and the family 409s until an admin clears it — the SAME
  // operational model as every other inventory op (add/adjust/reprint). Every reclaim
  // design reviewed (r9-r15) had an unprovable liveness assumption (no serverless
  // maxDuration off-Vercel, no heartbeat); the born 'reservation:' checkpoint plus the
  // armed draft keep the carry fully recoverable when the admin unwedges the row to
  // failed_pre_erp, after which the runner re-runs erp() under its own claim.

  // STAGING LEASES (r16/r17): the same primitive staging/assign holds. The pallet-
  // family lease serializes this move against a concurrent staging assignment (or
  // another mover) grabbing the pallet mid-carry; the so: lease additionally
  // serializes against that order's capacity math — resolved on FRESH runs from
  // preflight and on RETRIES from the live reservation or the op's stamped draft.
  // A miss is a clean 409 "try again"; a crashed holder self-expires within the TTL.
  if (priorOp && !preflightSo) {
    try {
      preflightSo = await moveLeaseSo(batch, idempotencyKey)
    } catch {
      return NextResponse.json(
        { error: 'Could not determine the reservation lock for this retry — try again shortly.' },
        { status: 503 }
      )
    }
  }
  let result: Awaited<ReturnType<typeof runInventoryOp>>
  try {
    // The lease scope covers the op AND all post-op reservation verification/restore
    // writes below — a restore outside the lease could race staging/assign (r17).
    result = await withLeases(
      [`pallet:${palletBase(batch)}`, ...(preflightSo ? [`so:${preflightSo}`] : [])],
      async () => {
        const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'move',
    createdBy: userId,
    // Reserved-pallet moves are BORN with the 'reservation:' checkpoint (spread into
    // the insert row via meta): the durable marker exists before any mutating step, so
    // no crash window can leave a carried reservation untracked (r11). Cleared below
    // once the carry is verified.
    meta: {
      item_code: itemCode,
      warehouse: toWarehouse,
      batch,
      family: palletBase(batch),
      ...(preflightReserved ? { error: 'reservation: carrying' } : {}),
    },
    erp: () =>
      transferInventory({
        batch,
        itemCode,
        toWarehouse,
        opKey: idempotencyKey,
        leasedSo: preflightSo,
        // Server-side marker only — same rule as the route's own verify gate (r22).
        restoreAuthorized: preflightReserved || markerAuthorizes(priorOp?.error),
        unverifiedMarker: String(priorOp?.error ?? '').startsWith('reservation: unverified'),
        // Arm the durable checkpoint the moment a carry is CONFIRMED inside erp() —
        // covers a reservation that appeared after the preflight snapshot (r14).
        onCarryStart: async () => {
          const { error: armErr } = await supabaseAdmin
            .from('inventory_ops_log')
            .update({ error: 'reservation: carrying' })
            .eq('idempotency_key', idempotencyKey)
            .eq('status', 'pending')
            .is('error', null)
          if (armErr) throw new Error(`Could not arm the reservation checkpoint — try again (${armErr.message})`)
          // Upgrade a fail-closed 'unverified' marker to an authorizing one — leaving
          // it would deny the durable authority a crash recovery needs (r24).
          const { error: upErr } = await supabaseAdmin
            .from('inventory_ops_log')
            .update({ error: 'reservation: carrying' })
            .eq('idempotency_key', idempotencyKey)
            .eq('status', 'pending')
            .like('error', 'reservation: unverified%')
          if (upErr) throw new Error(`Could not arm the reservation checkpoint — try again (${upErr.message})`)
          // CONFIRMED arming (r21): a zero-row match is NOT an error — read back and
          // require the marker to actually be present before any mutation.
          const { data: armed, error: readErr } = await supabaseAdmin
            .from('inventory_ops_log')
            .select('error')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle()
          if (readErr || !markerAuthorizes(armed?.error)) {
            throw new Error('Could not confirm the reservation checkpoint — try again')
          }
          armedThisRequest = true
        },
      }),
    // Reconcile is strictly READ-ONLY (r9): it may only recognize an already-submitted
    // entry. All mutating recovery lives in erp(), which runs under the CAS claim.
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
  })

  // EVERY successful response is reservation-verified before it leaves — resumed rows
  // (duplicate replays, erp_committed checkpoints, pending reconciles) reproduce only
  // the core body, so a lost reservation could otherwise replay as a clean success
  // (review r3, all legs). verifyOrRestoreMovedReservation is bound to this op's own
  // stamped Stock Entry: for a never-reserved move it answers null from one lookup, and
  // when the carry was interrupted it restores (or warns loudly). A fresh erp() WARNING
  // is also re-verified (r4): the second attempt often restores immediately — and a
  // reservation that actually bound despite a bookkeeping throw must not read as lost.
  if (result.status === 200) {
    const body = result.body as Record<string, unknown>
    // Restore authorization derives ONLY from the SERVER-SIDE marker: the row was born
    // armed (preflight saw a real reservation) or armed by onCarryStart (erp()
    // confirmed one). A fresh clean op can never restore — so a forged pre-created
    // tagged draft yields at most a verify nag, never a reservation write (r21). A
    // pure done-replay of a clean row remains verify-only (r7/r8).
    // Restores are also budget-gated (r28): the post-op write must not begin in the
    // lease tail; beyond the window the verify runs observation-only.
    const inBudget = Date.now() - routeStart < 420_000
    const allowRestore =
      inBudget &&
      (preflightReserved ||
        armedThisRequest ||
        markerAuthorizes(priorOp?.error) ||
        // 'unverified' may restore here too — the corroboration chain (stamp +
        // canceller identity + supersession) guards it, mirroring erp()'s at-dest
        // decision; otherwise a reconciled committed carry warns forever (r34).
        String(priorOp?.error ?? '').startsWith('reservation: unverified'))
    // EVERY 200 is LIVE-verified — including fresh carries whose erp() just claimed
    // reservedTo: the verifier gates on the live binding's warehouse/shape, so a
    // reservation still bound to the source bin can never certify or clear (r21).
    {
      const follow = await verifyOrRestoreMovedReservation({
        batch,
        itemCode,
        toWarehouse,
        opKey: idempotencyKey,
        allowRestore,
        leasedSo: preflightSo, // writes confined to the leased order (r29)
      })
      if (follow) {
        if (follow.reservedTo !== undefined) {
          // Verified (or restored) — drop any stale lost-reservation warning.
          delete body.warning
          delete body.reservationLostFrom
        } else {
          // The live check did NOT certify — an erp()-claimed reservedTo must not
          // survive into the response or the checkpoint-clear below.
          delete body.reservedTo
        }
        result.body = { ...body, ...follow }
      } else {
        delete body.reservedTo
        result.body = body
        if (
          body.warning === undefined &&
          (preflightReserved || String(priorOp?.error ?? '').startsWith('reservation:'))
        ) {
          // The op is checkpoint-armed yet verification found neither a binding nor a
          // recoverable stamp — a destroyed/forged tag must not produce a clean 200
          // while the durable marker says a reservation was being carried (r20).
          result.body = { ...body, orphanedReservationFrom: true }
        }
      }
    }
    // ORPHANED-CHECKPOINT SWEEP (r9, made VERIFY-ONLY in r10): the browser's key is
    // volatile — a reload after a reservation-lost warning mints a NEW key that knows
    // nothing about the older op's unresolved carry, so unresolved checkpoints are
    // discoverable by PALLET FAMILY. But the sweep NEVER writes ERP state (auto-restore
    // here would resurrect deliberately released reservations and undo the r7/r8
    // protections — r10, both legs). It only (a) clears checkpoints that resolved
    // themselves (pallet reserved again, or nothing recoverable on the stamp) and
    // (b) surfaces a LOUD standalone nag telling the floor to re-stage. The nag is a
    // separate field: it must not read as THIS move failing, must not keep the retry
    // key, and must never arm a checkpoint on this op's own row.
    const bodyAfter = result.body as Record<string, unknown>
    if (!priorOp && bodyAfter.reservedTo === undefined && bodyAfter.warning === undefined) {
      const { data: orphans, error: orphanErr } = await supabaseAdmin
        .from('inventory_ops_log')
        .select('idempotency_key')
        .eq('family', palletBase(batch))
        .eq('action', 'move')
        // EXACT batch: family-wide matching could verify/clear against a different
        // serial after a reissue (r15). A reissued pallet's orphaned checkpoint is
        // admin-visible in the ops log rather than auto-swept.
        .eq('batch', batch)
        .like('error', 'reservation:%')
        .neq('idempotency_key', idempotencyKey)
        .limit(1)
      if (orphanErr) {
        // A failed orphan lookup must not read as "no orphan" — surface the generic
        // nag so a known lost reservation is never silently unresolved (r33).
        result.body = { ...bodyAfter, orphanedReservationFrom: true }
      }
      const orphanKey = orphans?.[0]?.idempotency_key as string | undefined
      if (orphanKey) {
        const follow = await verifyOrRestoreMovedReservation({
          batch,
          itemCode,
          toWarehouse,
          opKey: orphanKey,
          allowRestore: false,
          leasedSo: preflightSo,
        })
        if (
          follow?.reservedTo !== undefined &&
          follow.reservationPartial === undefined &&
          follow.reservationObserved === undefined
        ) {
          // Resolved by a FULL binding — retire the checkpoint (a partial or merely
          // observed binding keeps it armed; r34).
          const { error: clrErr } = await supabaseAdmin
            .from('inventory_ops_log')
            .update({ error: null })
            .eq('idempotency_key', orphanKey)
          if (clrErr) console.error('move: clearing orphaned reservation checkpoint failed:', clrErr)
        } else {
          // Unresolved (loud warning) OR unrecoverable (null: the stamp is gone) —
          // the checkpoint stays ARMED and the nag surfaces either way; clearing on
          // null converted a destroyed recovery artifact into silence (r20).
          result.body = {
            ...bodyAfter,
            orphanedReservationFrom: follow?.reservationLostFrom ?? true,
          }
        }
      }
    }

    // Persist the reservation outcome on the op row so REPLAYS know whether this op
    // still owes a restore. 'reservation:' in `error` is inert to the state machine
    // (it only ever parses the 'label:' prefix on done rows) and move ops have no
    // label phase. Best-effort but logged — a lost write degrades to verify-only on
    // replay. Never armed from verify-only observations (see allowRestore above).
    const finalBody = result.body as Record<string, unknown>
    if (finalBody.warning === 'reservation_transfer_failed' && allowRestore) {
      const { error: markErr } = await supabaseAdmin
        .from('inventory_ops_log')
        .update({ error: 'reservation: transfer_failed' })
        .eq('idempotency_key', idempotencyKey)
      if (markErr) console.error('move: persisting reservation checkpoint failed:', markErr)
    } else if (
      finalBody.reservedTo !== undefined &&
      finalBody.reservationPartial === undefined &&
      finalBody.reservationDiffersFromCarried === undefined &&
      finalBody.reservationObserved === undefined
    ) {
      // SQL-guarded clear: the LIKE predicate confines this to reservation checkpoints
      // regardless of when the row was armed (born, late via onCarryStart, or by a
      // warning) - no stale in-memory snapshot decides (r15). A PARTIAL binding never
      // clears recovery state (r17).
      const { error: clearErr } = await supabaseAdmin
        .from('inventory_ops_log')
        .update({ error: null })
        .eq('idempotency_key', idempotencyKey)
        .like('error', 'reservation:%')
      if (clearErr) console.error('move: clearing reservation checkpoint failed:', clearErr)
    }

    // SWEEP on verified reservation (r17): the pallet's binding has been re-established
    // — every OTHER move op's lingering checkpoint for this batch is now moot, and
    // leaving one armed would let a stale key replay restore a superseded order.
    if (
      finalBody.reservedTo !== undefined &&
      finalBody.reservationPartial === undefined &&
      finalBody.reservationDiffersFromCarried === undefined &&
      finalBody.reservationObserved === undefined
    ) {
      const { error: sweepErr } = await supabaseAdmin
        .from('inventory_ops_log')
        .update({ error: null })
        .eq('action', 'move')
        .eq('batch', batch)
        .neq('idempotency_key', idempotencyKey)
        .like('error', 'reservation:%')
      if (sweepErr) console.error('move: sweeping superseded checkpoints failed:', sweepErr)
    }
  }

        return result
      },
      // 600s TTL (r26): self-hosted runtimes treat maxDuration as advisory; erp()'s
      // internal 540s step deadline guarantees no mutating step begins in the tail.
      600
    )
  } catch (e) {
    if (e instanceof LineLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 })
    }
    throw e
  }

  return NextResponse.json(result.body, { status: result.status })
}
