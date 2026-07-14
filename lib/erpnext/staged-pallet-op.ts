import { supabaseAdmin } from '@/lib/supabase-admin'
import { getBatchLocation } from './inventory'
import { reservationsForBatches, releaseBatchReservation, reserveBatchesToSO } from './staging'

// Un-stage → mutate → re-stage, done safely.
//
// ERPNext v15 pins a reserved batch to its warehouse and REFUSES to issue or move it — the
// error it throws is a misleading NegativeStockError (the stock is there; it's spoken for).
// So every stock-touching op on a STAGED pallet must release its Stock Reservation Entry
// first, mutate, then put the reservation back.
//
// The dangerous part is the middle. If the op dies between release and re-reserve — crash,
// timeout, lost response, or a retry that RESUMES an already-committed op and therefore
// never re-runs erp() — then "which Sales Order was this pallet on" is gone, the retry
// re-reserves nothing, and the pallet has silently fallen off its order. Nobody finds out
// until the truck ships short. (This is what all three review models blocked on, 2026-07-14.)
//
// The fix: the reservation is SNAPSHOTTED ONTO THE OP ROW before it is released, and the
// restore reads it back from there — never from a closure variable, which does not survive
// a retry. Pair the two calls:
//
//   const snap = await snapshotAndRelease(key, batch, itemCode)   // before the mutation
//   ... mutate ...
//   const warning = await restoreReservation(key, batch, itemCode)  // in finalize()
//
// restoreReservation is idempotent (it no-ops when the pallet is already reserved), which
// it must be: finalize() runs on fresh commits AND on resumes.

export interface ReservationSnapshot {
  so: string
  warehouse: string
  qty: number
}

/** Persist the pallet's staging reservation on the op row, then release it in ERPNext.
 *  Returns the snapshot (null when the pallet was not staged). The snapshot is written
 *  BEFORE the cancel, so a crash between the two leaves us able to restore, not guess. */
export async function snapshotAndRelease(
  opKey: string,
  batch: string,
  itemCode: string
): Promise<ReservationSnapshot | null> {
  // NEVER clobber a snapshot that is already on this row. It can be INHERITED: when this op
  // superseded a dead one that had already un-staged the pallet, we adopted its debt — the
  // SO it owes the pallet back to. If we overwrote that with whatever reservation the pallet
  // carries now, the original order would be short with nobody warned. (An existing snapshot
  // also means a previous attempt of THIS op already released; re-releasing is a no-op.)
  const { data: existing, error: readErr } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('reservation_snapshot')
    .eq('idempotency_key', opKey)
    .maybeSingle()
  if (readErr) throw new Error(`could not read the pallet's staging record: ${readErr.message}`)
  const prior = existing?.reservation_snapshot as ReservationSnapshot | null | undefined
  if (prior?.so) {
    // A snapshot already exists (inherited, or from an earlier attempt of this op), so the
    // pallet's debt is to prior.so. If some OTHER order has staged the pallet in the
    // meantime, do NOT cancel it: that would silently steal stock from an order that may be
    // mid-shipment. Refuse and let a human sort out the double-claim. (codex BLOCKER.)
    const current = (await reservationsForBatches([batch]))[batch]
    if (current && current.so !== prior.so) {
      throw new Error(
        `Pallet ${batch} is now staged to ${current.so} but is still owed to ${prior.so}. Resolve the conflict in ERPNext before changing this pallet.`
      )
    }
    if (current) await releaseBatchReservation(batch)
    return prior
  }

  const reservation = (await reservationsForBatches([batch]))[batch]
  if (!reservation) return null

  // The reservation carries the SO + qty but not the bin; read the bin while the pallet is
  // still sitting in it.
  const loc = await getBatchLocation(batch, itemCode)
  const snap: ReservationSnapshot = {
    so: reservation.so,
    warehouse: loc?.warehouse ?? '',
    qty: loc?.qty ?? reservation.reservedQty,
  }

  // Write FIRST. If this fails, do not release — an un-recorded release is the exact
  // failure we are eliminating.
  const { error } = await supabaseAdmin
    .from('inventory_ops_log')
    .update({ reservation_snapshot: snap })
    .eq('idempotency_key', opKey)
  if (error) throw new Error(`could not record the pallet's staging before releasing it: ${error.message}`)

  await releaseBatchReservation(batch)
  return snap
}

/** Re-reserve `batch` to the Sales Order recorded by snapshotAndRelease. Safe to call more
 *  than once and safe to call when nothing was ever released. Returns a warning string when
 *  the pallet ended up NOT staged (caller persists + surfaces it), else null. */
export async function restoreReservation(
  opKey: string,
  batch: string,
  itemCode: string
): Promise<string | null> {
  const { data: row, error } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('reservation_snapshot')
    .eq('idempotency_key', opKey)
    .maybeSingle()
  // A failed read must NOT be mistaken for "this pallet was never staged" — that would
  // report a clean success while quietly leaving the order unreserved. Fail loud instead:
  // the stock is already correct, so the caller turns this into a visible warning.
  if (error) throw new Error(`could not read the pallet's staging record: ${error.message}`)
  const snap = row?.reservation_snapshot as ReservationSnapshot | null | undefined
  if (!snap?.so) return null // pallet was never staged — nothing to restore

  // Idempotence: a previous attempt (or the fresh commit before a retry) may already have
  // re-reserved it. Never stack a second SRE on the same pallet.
  // Reserve wherever the pallet actually IS now — a move lands it in a new bin, a reissue
  // under a new serial. The snapshot's warehouse is only the pre-op position.
  const loc = await getBatchLocation(batch, itemCode)

  const current = (await reservationsForBatches([batch]))[batch]
  if (current) {
    // Reserved to the WRONG order: while the pallet sat un-staged, a concurrent staging run
    // claimed it for someone else. Treating that as "already restored" would report success
    // while the original order silently ships short. Don't steal it back (whoever holds it
    // may be mid-shipment) — report it.
    if (current.so !== snap.so) return 'reservation_transfer_failed'
    // Right order, but is the WHOLE pallet covered? A partial SRE leaves the order
    // under-backed while looking restored. (codex BLOCKER, round 4.)
    if (loc && loc.qty > 0 && current.reservedQty < loc.qty) return 'reservation_transfer_failed'
    return null // fully restored already — idempotent no-op
  }

  if (!loc || loc.qty <= 0) {
    // No stock under this code (e.g. it was removed, or reissued to a new serial the caller
    // restores instead). Nothing to reserve, but the order lost its pallet — say so.
    return 'reservation_transfer_failed'
  }

  await reserveBatchesToSO({
    soName: snap.so,
    items: [{ batch, itemCode, warehouse: loc.warehouse, qty: loc.qty }],
  })
  return null
}
