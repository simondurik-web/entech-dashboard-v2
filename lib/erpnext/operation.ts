import { supabaseAdmin } from '@/lib/supabase-admin'

/** Resolve a user id to a display name (full name, else email) for labels/logs. */
export async function resolveUserName(userId: string | null): Promise<string> {
  if (!userId) return ''
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single()
  return data?.full_name || data?.email || ''
}

// Idempotent inventory operation runner.
//
// The hard requirement: a network timeout / crash must NEVER produce a duplicate
// ERPNext receipt. We use inventory_ops_log as a state machine keyed by a
// client-supplied idempotency key:
//
//   pending --(ERP commits)--> erp_committed --(label enqueued)--> done
//      |                                                            ^
//      +--(ERP threw, nothing committed)--> failed_pre_erp --retry--+
//
// Rules on a same-key retry:
//   done           -> return the cached result (no work)
//   erp_committed  -> DO NOT touch ERP again; just (re)enqueue the label -> done
//   failed_pre_erp -> ERP never committed, safe to re-run the ERP step
//   pending        -> ambiguous; try reconcile() to see if ERP actually committed,
//                     else 409 (a genuinely stuck row needs a human)

export interface Committed {
  batch?: string
  stockEntry?: string | null
  // Optional extra fields an erp() wants surfaced in the success response body (e.g. a bulk
  // transfer's moved-count + skipped list). Merged into the `done` body.
  extra?: Record<string, unknown>
}

export interface RunOpArgs {
  key: string
  action: string
  createdBy: string | null
  meta: Record<string, unknown> // item_code, qty, warehouse, station_id, batch
  erp: () => Promise<Committed>
  // Optional: detect whether ERP already performed this op (closes the tiny
  // window between an ERP commit and the erp_committed write).
  reconcile?: () => Promise<Committed | null>
  // Optional label/print step; returns the print job id (or null).
  label?: (committed: Committed) => Promise<string | null>
  // Required to supersede a DEAD failed_pre_erp row holding this pallet family.
  // Given SOMEONE ELSE'S op key, answer: did ERP commit any stock document under it?
  // Routes pass `(k) => reconcileStockEntry(k).then(Boolean)`. Without it we never
  // supersede — silence is not consent when stock integrity is the stake.
  erpTouchedKey?: (otherKey: string) => Promise<boolean>
  // Runs once ERP is known-committed — on a FRESH commit AND on a resumed/reconciled one.
  // erp() does not run on a resume, so anything that must happen after the stock lands
  // (re-reserving a pallet we un-staged before mutating it) belongs HERE, not in erp().
  // Otherwise a retry that resumes an already-committed op skips the re-reserve and the
  // pallet silently falls off its Sales Order. Must be IDEMPOTENT — it can run twice.
  // Returns an optional warning to persist + surface.
  finalize?: (committed: Committed) => Promise<string | null>
}

export interface RunOpResult {
  status: number
  body: Record<string, unknown>
}

const LOG = () => supabaseAdmin.from('inventory_ops_log')

// A failed_pre_erp row is only superseded once it is at least this old — see the age-gate
// comment below. Long enough that an ERPNext submit which timed out has certainly settled;
// far shorter than the hours/days a real jam sits for.
const SUPERSEDE_MIN_AGE_MS = 15 * 60 * 1000

// How long a finalize claim on an erp_committed row is exclusive. Far beyond any request's
// maxDuration (120s), so a LIVE finalizer can never be raced — only a crashed one succeeded.
const FINALIZE_LEASE_MS = 15 * 60 * 1000

// Same age gate for retiring a stage-lock MARKER left by a crashed staging request (see
// claim_staging_families in 20260714b_staging_family_locks.sql — the two must stay in sync).
const STAGE_LOCK_STALE_MS = 15 * 60 * 1000

// Actions whose erp() releases a staging reservation. If one of these died without recording
// its staging finding, it predates the snapshot protocol and cannot be safely taken over.
const RESERVATION_TOUCHING = new Set(['move', 'adjust', 'reprint', 'remove'])

export async function runInventoryOp(args: RunOpArgs): Promise<RunOpResult> {
  const { key, action, createdBy, meta, erp, reconcile, label, erpTouchedKey, finalize } = args
  // '-fam-' is the reserved separator of staging lock-marker keys (<stagingKey>-fam-<family>).
  // A client key containing it could collide with — or be LIKE-matched by — another key's
  // marker namespace (round-17 should-fix). Real client keys are crypto.randomUUID() (hex,
  // no 'm'), so nothing legitimate is refused.
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key) || key.includes('-fam-')) {
    return { status: 400, body: { error: 'invalid idempotencyKey' } }
  }
  let committed: Committed | null = null

  // The lease we hold on this row: the pending_since we ourselves stamped. Every terminal
  // write is guarded by it, so a worker whose attempt was superseded or reclaimed can never
  // overwrite the row that replaced it.
  let lease: string | null = null
  // Update THIS row only while we still hold the lease on it (supabase-js requires the
  // filters after .update()).
  const updateOwn = (payload: Record<string, unknown>) => {
    const q = LOG().update(payload).eq('idempotency_key', key)
    return lease ? q.eq('pending_since', lease) : q
  }

  // Reserve the key.
  const insertRow = () => {
    const t = new Date().toISOString()
    return LOG()
      .insert({
        idempotency_key: key,
        action,
        status: 'pending',
        created_by: createdBy,
        pending_since: t,
        ...meta,
      })
      .then((r) => {
        if (!r.error) lease = t
        return r
      })
  }
  // Claim the exclusive right to run finalize() on an erp_committed row — EVERY path that
  // reaches finalize() without already holding a fresh exclusive lease must pass through
  // this, or two workers can re-reserve the same pallet concurrently (round-17 panel
  // BLOCKER: the reconcile-success paths used to fall through to finalize un-leased).
  //
  // The claim is TIME-GATED, not a CAS on a value we read. A read-value CAS is
  // TRANSFERABLE: while worker A is mid-finalize, worker B reads A's fresh stamp and CASes
  // it away — B "wins" a claim A still believes it holds, and both run finalize (the exact
  // double-reserve this exists to prevent; round-16 blocker #2). Honoring a claim only when
  // the previous one is NULL or older than FINALIZE_LEASE_MS makes a LIVE finalizer
  // unraceable — no request survives past maxDuration (120s), let alone 15 minutes — while
  // a crashed worker's claim ages out so a later retry can still finish the re-reserve.
  // The cost: for up to the lease window after a crash, a same-key retry answers duplicate
  // (with finalizePending + any persisted warning) instead of finishing the job.
  //
  // Two sequential CAS attempts instead of one OR'd predicate: PostgREST rejects `or=`
  // filters on mutations (PATCH + or= returns 42703 for ANY column — verified live
  // 2026-07-14; GET + or= and plain PATCH filters are fine). Each UPDATE is individually
  // atomic, and losing both is conclusive: a stamp fresh enough to defeat the .lt() also
  // defeats the .is(null). A transport/DB error is NOT a loss — fail closed instead of
  // reporting duplicate while nobody actually holds the lease (round-17 should-fix).
  const claimFinalizeLease = async (): Promise<'won' | 'lost' | 'error'> => {
    const t = new Date().toISOString()
    const leaseCutoff = new Date(Date.now() - FINALIZE_LEASE_MS).toISOString()
    const first = await LOG()
      .update({ pending_since: t })
      .eq('idempotency_key', key)
      .eq('status', 'erp_committed')
      .is('pending_since', null)
      .select('idempotency_key')
    if (first.error) return 'error'
    let rows = first.data
    if (!rows || rows.length === 0) {
      const second = await LOG()
        .update({ pending_since: t })
        .eq('idempotency_key', key)
        .eq('status', 'erp_committed')
        .lt('pending_since', leaseCutoff)
        .select('idempotency_key')
      if (second.error) return 'error'
      rows = second.data
    }
    if (!rows || rows.length === 0) return 'lost'
    lease = t
    return 'won'
  }
  // The lost-lease reply: ERP already committed, no ERP writes happen here, and the claim
  // holder may still be RUNNING finalize — so the re-staging is not confirmed done. Callers
  // must not read this as "fully finished" (finalizePending), and any persisted warning is
  // replayed (a lost response must never resurface as a clean success while the pallet may
  // still be off its order).
  const finalizePendingReply = (c: Committed, warning?: string | null, unstagedFrom?: string | null, printJobId?: string | null): RunOpResult => ({
    status: 200,
    body: {
      ok: true,
      duplicate: true,
      finalizePending: true,
      batch: c.batch,
      stockEntry: c.stockEntry,
      printJobId: printJobId ?? null,
      ...(warning ? { warning, unstagedFrom: unstagedFrom ?? undefined } : {}),
    },
  })

  // Resolve a LOST finalize lease. The holder may already have FINISHED (written 'done')
  // between our claim attempt and now — re-read so a finished-clean op returns the normal
  // done/duplicate body (with any label-pending + warning replay), NOT a false finalizePending
  // error flash (round-18 codex #3). If it's still erp_committed, the holder is genuinely
  // mid-finalize, so finalizePending is right.
  const resolveLostLease = async (c: Committed): Promise<RunOpResult> => {
    const { data: now } = await LOG()
      .select('status, batch, erp_stock_entry, print_job_id, error, warning, reservation_snapshot')
      .eq('idempotency_key', key)
      .maybeSingle()
    if (now?.status === 'done') {
      const labelFailed = !now.print_job_id && typeof now.error === 'string' && now.error.startsWith('label:')
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          batch: now.batch,
          stockEntry: now.erp_stock_entry,
          printJobId: now.print_job_id,
          ...(labelFailed ? { labelPending: true, message: 'Stock recorded; label print failed — use Reprint.' } : {}),
          ...(now.warning ? { warning: now.warning, unstagedFrom: now.reservation_snapshot?.so } : {}),
        },
      }
    }
    return finalizePendingReply(
      c,
      now?.warning ?? null,
      (now?.reservation_snapshot as { so?: string } | null)?.so ?? null,
      now?.print_job_id ?? null,
    )
  }

  // Transition a reconcile-proven-committed row to erp_committed AND take the finalize lease
  // in ONE compare-and-swap on the prior status. Only the worker that flips the status wins,
  // and it stamps its OWN fresh pending_since — so a stale-but-fresh lease left behind by the
  // dead worker that wrote failed_pre_erp/pending can't block re-staging for the whole lease
  // window (round-18 codex #1: without this, a reconcile-success retry loses claimFinalizeLease
  // to a fresh-looking dead stamp and only warns for up to FINALIZE_LEASE_MS). A loser (someone
  // else already transitioned) falls through to claimFinalizeLease against the live holder.
  // Returns 'won' (this worker holds the lease — proceed to finalize) or a RunOpResult to return.
  const claimViaReconcileTransition = async (r: Committed, fromStatus: string): Promise<'won' | RunOpResult> => {
    const t = new Date().toISOString()
    const { data: won, error } = await LOG()
      .update({ status: 'erp_committed', batch: r.batch ?? null, erp_stock_entry: r.stockEntry ?? null, pending_since: t })
      .eq('idempotency_key', key)
      .eq('status', fromStatus)
      .select('idempotency_key')
    if (error) return { status: 503, body: { error: 'Could not confirm the operation state; try again.' } }
    if (won && won.length > 0) {
      lease = t
      return 'won'
    }
    // Someone else transitioned it first — claim (or lose) the lease against the live holder.
    const l = await claimFinalizeLease()
    if (l === 'error') return { status: 503, body: { error: 'Could not confirm the operation state; try again.' } }
    if (l === 'lost') return await resolveLostLease(r)
    return 'won'
  }

  let { error: insErr } = await insertRow()

  if (insErr) {
    let { data: ex } = await LOG()
      .select('status, action, family, batch, item_code, station_id, qty, warehouse, erp_stock_entry, print_job_id, error, warning, reservation_snapshot, pending_since')
      .eq('idempotency_key', key)
      .maybeSingle()
    if (!ex && insErr.code === '23505' && meta.family) {
      // A stage-lock MARKER may be holding this family. Markers are pure lock rows staging
      // inserts via claim_staging_families — nothing ever executes under a marker's key (no
      // erp() run, no stock document), so retiring a stale one cannot race in-flight work
      // and does not weaken one-worker-per-key. A LIVE marker (staging still executing, or
      // finished less than the gate ago) is left alone and this op 409s below like any
      // other conflict. Without this, a crashed staging request would jam every pallet it
      // touched — recreating the exact jam class this file exists to clear.
      const markerCutoff = new Date(Date.now() - STAGE_LOCK_STALE_MS).toISOString()
      const { data: retiredMarkers } = await LOG()
        .update({ status: 'cancelled', error: `stale stage-lock retired by ${key}` })
        .eq('family', meta.family)
        .eq('action', 'stage-lock')
        .eq('status', 'pending')
        .lt('pending_since', markerCutoff)
        .select('idempotency_key')
      if (retiredMarkers && retiredMarkers.length > 0) {
        const retry = await insertRow()
        if (!retry.error) {
          insErr = null
        }
      }
    }
    if (insErr && !ex && insErr.code === '23505' && meta.family && erpTouchedKey) {
      // No row for THIS key -> the insert tripped the partial unique index on `family`:
      // a DIFFERENT op holds this pallet family. Before 2026-07-14 a failed_pre_erp
      // holder held it FOREVER — every new attempt 409'd "ask an admin to clear it from
      // the ops log", and 11 pallets sat jammed for days (Joseles's 4JA5). We now
      // supersede such a holder, but ONLY after proving ERP is clean under its key.
      //
      // Why the proof is mandatory: failed_pre_erp does NOT reliably mean "ERP never
      // committed". erp() also throws when a submit SUCCEEDS but the response times out,
      // and a reissue is multi-step (issue, then receipt) so it can throw with stock
      // already moved. Superseding such a row would let this new op run CONCURRENTLY with
      // half-committed ERP state -> duplicate receipts / corrupted pallet. Same-key
      // retries have always resolved that ambiguity via reconcile(); a new key must not
      // skip it. (Both codex and grok flagged exactly this; codex BLOCKed on it.)
      //
      // So: supersede only holders with NO stock document stamped [op:<their key>].
      // The real jam — a NegativeStockError thrown at submit on a staged pallet — commits
      // nothing, so it clears. A half-finished op still holds the family and still needs
      // a human, which is the correct, conservative outcome.
      // Age gate: a submit that TIMED OUT can still land in ERPNext moments later, so a
      // negative erpTouchedKey() on a FRESH failure proves nothing. Only consider holders
      // whose last failure is old enough that any in-flight ERP write has certainly settled;
      // only then is the probe meaningful. Gate on failed_at (when the row last entered
      // failed_pre_erp), NOT created_at — an old row that just timed out AGAIN is freshly
      // ambiguous, and created_at would wave it straight through. (codex BLOCKER, round 3.)
      const staleBefore = new Date(Date.now() - SUPERSEDE_MIN_AGE_MS).toISOString()
      // At most ONE row can hold a family (the partial unique index guarantees it).
      const { data: holders } = await LOG()
        .select('idempotency_key, failed_at, action, reservation_snapshot')
        .eq('family', meta.family)
        .eq('status', 'failed_pre_erp')
        .neq('idempotency_key', key)
        .lt('failed_at', staleBefore)
        .limit(1)

      // Vet the holder against ERP FIRST. Only a key with no stock document stamped
      // [op:<key>] may be retired; anything ERP touched still holds the pallet and still
      // needs a human. `failed_at` is captured here and re-checked inside the RPC, so a
      // holder that comes back to life and touches ERP after this probe is left alone.
      const holder = holders?.[0]
      if (holder && (await erpTouchedKey(holder.idempotency_key))) {
        return {
          status: 409,
          body: {
            error:
              'A previous operation on this pallet stopped part-way through and did change ERPNext. It needs an admin to reconcile it before the pallet can be used again.',
          },
        }
      }
      // FAIL CLOSED on a holder that predates this protocol. Every op written since records
      // its staging finding — the Sales Order, or an explicit "checked, not staged" — BEFORE
      // it releases anything. A holder with no record at all is therefore a legacy row from
      // the old code, which released the reservation without ever writing it down. Taking it
      // over would read "unknown" as "was never staged", finish cleanly, and leave the
      // original order short. Hand it to a human instead. (codex BLOCKER.)
      // (Verified 2026-07-14: prod has ZERO rows in a takeover-eligible state, so this path
      // is unreachable today; it exists so it can never become reachable.)
      if (
        holder &&
        (holder as { reservation_snapshot?: unknown }).reservation_snapshot == null &&
        RESERVATION_TOUCHING.has((holder as { action?: string }).action ?? '')
      ) {
        return {
          status: 409,
          body: {
            error:
              "A previous operation on this pallet failed before we recorded whether it was staged, so it isn't safe to take over automatically. An admin needs to check the pallet's Sales Order.",
          },
        }
      }

      if (holder) {
        // ONE transaction: retire the dead holders, claim the family, and inherit their
        // reservation debt (the Sales Order the pallet still owes itself back to). Doing
        // this as three separate writes left the family briefly UNLOCKED between the
        // retirement and our insert — a racing request could claim it without the debt and
        // then complete "cleanly" with the pallet permanently detached from its order.
        // Losing the race now rolls the whole thing back: the dead holder keeps holding the
        // family, its debt stays recorded, and the next attempt re-runs the hand-off.
        const { data: claimed, error: rpcErr } = await supabaseAdmin.rpc('supersede_and_claim_family', {
          p_key: key,
          p_action: action,
          p_created_by: createdBy,
          p_family: meta.family as string,
          p_clean_key: holder.idempotency_key,
          p_failed_at: holder.failed_at,
          p_item_code: (meta.item_code as string) ?? null,
          p_qty: (meta.qty as number) ?? null,
          p_warehouse: (meta.warehouse as string) ?? null,
          p_station_id: (meta.station_id as string) ?? null,
          p_batch: (meta.batch as string) ?? null,
          p_result_batch: (meta.result_batch as string) ?? null,
        })
        if (rpcErr) {
          // Fail closed: we do not hold the family and nothing was half-done.
          return { status: 503, body: { error: 'Could not take over a previous failed operation on this pallet; try again.' } }
        }
        if (claimed) {
          // The row is ours, already carrying any inherited debt. Fall through to the normal
          // first-run path (ERP phase). Read back the pending_since the function stamped —
          // that is our lease on this attempt.
          const { data: mine } = await LOG().select('pending_since').eq('idempotency_key', key).maybeSingle()
          lease = (mine?.pending_since as string) ?? null
          insErr = null
          ex = null
        }
      }
    }
    if (insErr && !ex) {
      // Still conflicting and no row for this key -> a genuinely ACTIVE op holds the family.
      if (insErr.code === '23505') {
        return { status: 409, body: { error: 'Another operation is in progress for this pallet; try again shortly.' } }
      }
      return { status: 500, body: { error: 'operation log conflict' } }
    }
    if (ex) {

    // Idempotency-key identity binding: a retry MUST describe the same operation. If a key
    // is reused for a different action/pallet (client bug), refuse — otherwise we'd run the
    // CURRENT closure against an unrelated row and (worse) without the right family lock.
    // Bind the full operation identity so a reused key can't run THIS request's closures
    // (esp. the label) against a different payload. We compare action + every stable
    // identity field: family (= palletBase, invariant; `batch` is excluded because it's
    // rewritten to the new serial on commit), the label inputs item_code + station, and
    // the stock inputs qty + warehouse. Legit retries match (adjust/reprint pin qty from
    // the prior op; add/move resend the same payload); only a changed-payload key reuse
    // (a client bug) is rejected. (The client key already hashes the payload.)
    const sameField = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)
    const sameNum = (a: unknown, b: unknown) =>
      (a == null ? null : Number(a)) === (b == null ? null : Number(b))
    const sameOp =
      ex.action === action &&
      sameField(ex.family, meta.family) &&
      sameField(ex.item_code, meta.item_code) &&
      sameField(ex.station_id, meta.station_id) &&
      sameField(ex.warehouse, meta.warehouse) &&
      sameNum(ex.qty, meta.qty)
    if (!sameOp) {
      return { status: 409, body: { error: 'This idempotency key was already used for a different operation.' } }
    }

    if (ex.status === 'failed' || ex.status === 'error' || ex.status === 'cancelled') {
      // Terminal failure — including a failed_pre_erp row another op superseded. This row
      // no longer holds the family lock (the partial index excludes these statuses), so
      // re-running erp() under it could run CONCURRENTLY with a newer op on the same
      // pallet. Refuse; the client starts over with a fresh key.
      return { status: 409, body: { error: 'This attempt was closed or superseded by a newer operation on the pallet; start the operation again.' } }
    }

    if (ex.status === 'done') {
      // A 'done' row whose stock committed but whose label FAILED carries a `label:` error
      // and no print_job_id. Surface labelPending on the duplicate too, so a client retry
      // after a lost response still learns the label needs reprinting.
      const labelFailed = !ex.print_job_id && typeof ex.error === 'string' && ex.error.startsWith('label:')
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          batch: ex.batch,
          stockEntry: ex.erp_stock_entry,
          printJobId: ex.print_job_id,
          ...(labelFailed ? { labelPending: true, message: 'Stock recorded; label print failed — use Reprint.' } : {}),
          // Replay a persisted warning: a lost response followed by a retry must NOT report
          // a clean success when the pallet came off its order (codex BLOCKER, 2026-07-14).
          ...(ex.warning ? { warning: ex.warning, unstagedFrom: ex.reservation_snapshot?.so } : {}),
        },
      }
    }
    if (ex.status === 'erp_committed') {
      committed = { batch: ex.batch ?? undefined, stockEntry: ex.erp_stock_entry ?? null }
      // finalize() re-creates a staging reservation and is check-then-create — two
      // concurrent same-key resumes could each make one. Exactly ONE worker proceeds.
      const l = await claimFinalizeLease()
      if (l === 'error') {
        return { status: 503, body: { error: 'Could not confirm the operation state; try again.' } }
      }
      if (l === 'lost') {
        return await resolveLostLease(committed)
      }
    } else if (ex.status === 'failed_pre_erp') {
      // Before re-running ERP, confirm it really didn't commit (a post-commit
      // checkpoint failure can also land here). If it did, resume; never re-run.
      if (reconcile) {
        const r = await reconcile()
        if (r) {
          committed = r
          // Transition failed_pre_erp -> erp_committed AND claim the finalize lease in one CAS,
          // stamping a fresh owning lease so the dead worker's stale-fresh pending_since can't
          // block re-staging (round-18 codex #1). A loser gets a RunOpResult to return.
          const outcome = await claimViaReconcileTransition(r, 'failed_pre_erp')
          if (outcome !== 'won') return outcome
        }
      }
      if (!committed) {
        // Atomically claim the retry (compare-and-swap on status) so two
        // concurrent retries can't both proceed to re-run ERP.
        const t = new Date().toISOString()
        const { data: claimed } = await LOG()
          .update({ status: 'pending', error: null, pending_since: t })
          .eq('idempotency_key', key)
          .eq('status', 'failed_pre_erp')
          .select('idempotency_key')
        if (!claimed || claimed.length === 0) {
          return { status: 409, body: { error: 'Operation is being retried; try again shortly' } }
        }
        lease = t
        // Re-probe AFTER taking the lease. reconcile() ran BEFORE the CAS, so a submit that
        // timed out could have landed in the gap; re-running erp() would duplicate it. Same
        // fence as the stale-pending path. (codex BLOCKER.)
        // No claimFinalizeLease needed if this resumes to finalize: the status CAS above was
        // single-winner and stamped a FRESH pending_since — this worker already holds an
        // exclusive lease that any concurrent claimer's age gate will lose to.
        if (erpTouchedKey && (await erpTouchedKey(key))) {
          const r2 = reconcile ? await reconcile() : null
          if (r2) {
            committed = r2
            await updateOwn({ status: 'erp_committed', batch: r2.batch ?? null, erp_stock_entry: r2.stockEntry ?? null })
          } else {
            await updateOwn({ status: 'failed_pre_erp', failed_at: new Date().toISOString(), error: 'ERP committed under this key but could not be reconciled' })
            return { status: 409, body: { error: 'A previous attempt on this pallet reached ERPNext but could not be confirmed. It needs an admin to reconcile it.' } }
          }
        }
      }
    } else {
      // pending — try to reconcile against ERP before refusing.
      if (reconcile) {
        const r = await reconcile()
        if (r) {
          committed = r
          // Transition pending -> erp_committed AND claim the finalize lease in one CAS.
          // Here especially the loser path matters: a 'pending' row very often means the
          // ORIGINAL worker is still alive just past its stock commit, about to finalize
          // itself — the CAS lets it keep its lease and we defer with finalizePending rather
          // than racing it. (round-17 blocker; round-18 codex #1 made the transition stamp
          // a fresh owning lease so a genuinely-dead pending row doesn't block for 15 min.)
          const outcome = await claimViaReconcileTransition(r, 'pending')
          if (outcome !== 'won') return outcome
        }
      }
      // A row CAN die in 'pending' (crash after erp() started, before any status write). We
      // deliberately do NOT auto-recover that here.
      //
      // An earlier version reclaimed a stale pending row and re-ran erp(). Both codex and
      // grok blocked it, correctly: nothing proves the original worker is finished, so two
      // workers could submit stock documents for the same operation — duplicate receipts,
      // issues, transfers. Wrong inventory is far worse than a stuck pallet, and this trade
      // was the wrong way round. A stuck pending row stays a 409 until an admin retires it;
      // the next operation then supersedes it, INHERITS its reservation snapshot, and
      // re-stages the pallet — so the order is made whole, just not automatically.
      //
      // The one-worker-per-key invariant is what keeps stock correct. Don't weaken it.
      if (!committed) {
        return {
          status: 409,
          body: { error: 'This operation is already in progress; if it appears stuck, contact an admin' },
        }
      }
    }
    }
  }

  // ERP phase (skipped when resuming an erp_committed row).
  if (!committed) {
    let r: Committed
    // ONLY an erp() throw means nothing committed -> failed_pre_erp.
    try {
      r = await erp()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Stamp failed_at: the supersede age gate keys off WHEN THIS ROW LAST FAILED, not
      // when it was created. A long-lived row that just timed out again is freshly
      // ambiguous — its ERPNext write may still land — and must restart the clock.
      // Guarded by the lease: if this attempt was superseded or reclaimed while erp() ran,
      // the row now belongs to a newer op — flipping it to failed_pre_erp would re-lock the
      // pallet and could clobber a finished operation. Losing the lease means our result is
      // moot, so we say nothing about the row and just report the failure. (grok BLOCKER.)
      await updateOwn({ status: 'failed_pre_erp', error: msg.slice(0, 500), failed_at: new Date().toISOString() })
        .eq('status', 'pending')
      return { status: 502, body: { error: `${action} failed: ${msg.slice(0, 200)}` } }
    }
    committed = r
    // Best-effort checkpoint. If THIS write fails the row stays 'pending';
    // a retry's reconcile() will detect the committed ERP doc and resume —
    // it must NOT be treated as a pre-ERP failure (that would duplicate stock).
    await updateOwn({ status: 'erp_committed', batch: r.batch ?? null, erp_stock_entry: r.stockEntry ?? null })
      .eq('status', 'pending')
      .then(undefined, () => undefined)
  }

  // Finalize phase. Runs whenever ERP is known-committed — on a fresh commit AND on a
  // resumed/reconciled one, because erp() does NOT re-run on a resume. This is where a
  // pallet that was un-staged in order to mutate it gets re-reserved, restoring it from
  // the snapshot persisted on the op row (never from a closure variable — the closure is
  // gone on a retry, which is exactly how a pallet used to fall off its Sales Order in
  // silence). Idempotent by contract: it may run more than once. A failure here does NOT
  // fail the op — the stock is already correct — but it DOES persist a warning, so even an
  // idempotent replay of a lost response reports "unstaged", never a clean success.
  let warning: string | null = null
  let unstagedFrom: string | undefined
  if (finalize) {
    try {
      warning = await finalize(committed)
    } catch (e) {
      console.error(`${action} ${key}: finalize failed:`, e)
      warning = 'reservation_transfer_failed'
    }
    if (warning) {
      await updateOwn({ warning }).then(undefined, () => undefined)
      // Name the order the pallet fell off — "re-stage it" is not actionable without it.
      const { data: snapRow } = await LOG()
        .select('reservation_snapshot')
        .eq('idempotency_key', key)
        .maybeSingle()
      unstagedFrom = (snapRow?.reservation_snapshot as { so?: string } | null)?.so
    }
  }

  // Label phase (optional). Stock is already correct; a print failure is NOT a
  // failure of the operation — surface labelPending so the user can reprint.
  let printJobId: string | null = null
  if (label) {
    try {
      printJobId = await label(committed)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Stock is already correct; only the label failed. Move to a TERMINAL 'done' state
      // (recording the label error + committed batch) so the active-family lock RELEASES —
      // otherwise the row sits at erp_committed, the family stays locked, and the user's
      // Reprint would hit 409. Reprint then reissues normally to recover the label.
      await updateOwn({ status: 'done', batch: committed.batch ?? null, erp_stock_entry: committed.stockEntry ?? null, error: `label: ${msg.slice(0, 400)}`, ...(warning ? { warning } : {}) })
      return {
        status: 200,
        body: {
          ok: true,
          labelPending: true,
          batch: committed.batch,
          stockEntry: committed.stockEntry,
          message: 'Stock recorded; label print failed — use Reprint.',
          ...(warning ? { warning, unstagedFrom } : {}),
        },
      }
    }
  }

  // Persist batch + stock entry again on the final write: the mid-flight erp_committed
  // checkpoint is best-effort (its failure is swallowed), and for a reissue that's where
  // `batch` flips from the old serial to the new one. Writing it here too guarantees the
  // row ends up pointing at the committed (new) serial even if the checkpoint was lost.
  await updateOwn({
      status: 'done',
      print_job_id: printJobId,
      batch: committed.batch ?? null,
      erp_stock_entry: committed.stockEntry ?? null,
      // Persist the warning on the TERMINAL write too. The earlier update is best-effort;
      // if it failed and this one omitted the warning, a lost-response retry would replay
      // the row as a clean success while the pallet is still off its order.
      ...(warning ? { warning } : {}),
  })
  return {
    status: 200,
    body: {
      ok: true,
      batch: committed.batch,
      stockEntry: committed.stockEntry,
      printJobId,
      ...(committed.extra ?? {}),
      ...(warning ? { warning, unstagedFrom } : {}),
    },
  }
}
