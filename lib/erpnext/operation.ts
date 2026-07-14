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

export async function runInventoryOp(args: RunOpArgs): Promise<RunOpResult> {
  const { key, action, createdBy, meta, erp, reconcile, label, erpTouchedKey, finalize } = args
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) {
    return { status: 400, body: { error: 'invalid idempotencyKey' } }
  }
  let committed: Committed | null = null

  // Reserve the key.
  const insertRow = () =>
    LOG().insert({
      idempotency_key: key,
      action,
      status: 'pending',
      created_by: createdBy,
      ...meta,
    })
  let { error: insErr } = await insertRow()

  if (insErr) {
    let { data: ex } = await LOG()
      .select('status, action, family, batch, item_code, station_id, qty, warehouse, erp_stock_entry, print_job_id, error, warning, reservation_snapshot')
      .eq('idempotency_key', key)
      .maybeSingle()
    if (!ex && insErr.code === '23505' && meta.family && erpTouchedKey) {
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
      const { data: holders } = await LOG()
        .select('idempotency_key, reservation_snapshot')
        .eq('family', meta.family)
        .eq('status', 'failed_pre_erp')
        .neq('idempotency_key', key)
        .lt('failed_at', staleBefore)
      let superseded = 0
      let dirtyHolder = false
      let inheritedSnapshot: unknown = null
      for (const h of holders ?? []) {
        if (await erpTouchedKey(h.idempotency_key)) {
          dirtyHolder = true // ERP has state under this key — hands off.
          continue
        }
        // CAS: only flip a row that is STILL failed_pre_erp, so we can't stomp a
        // same-key retry that just claimed it back to 'pending' and is re-running ERP.
        const { data: flipped } = await LOG()
          .update({ status: 'failed', error: `superseded by ${key} (no ERP commit under this key)` })
          .eq('idempotency_key', h.idempotency_key)
          .eq('status', 'failed_pre_erp')
          .select('idempotency_key')
        if (flipped && flipped.length > 0) {
          superseded++
          // INHERIT the dead op's reservation snapshot. It may have already un-staged the
          // pallet (released the SRE) and then died — the SO is recorded ONLY on its row.
          // Retiring that row without carrying the snapshot forward strands the pallet off
          // its Sales Order forever: our finalize() would find no snapshot and no-op, and
          // the order ships short with nobody warned. Carrying it means our finalize()
          // re-stages the pallet the dead op abandoned. (codex + grok BLOCKER, round 3.)
          if (!inheritedSnapshot && h.reservation_snapshot) inheritedSnapshot = h.reservation_snapshot
        }
      }
      if (dirtyHolder) {
        return {
          status: 409,
          body: {
            error:
              'A previous operation on this pallet stopped part-way through and did change ERPNext. It needs an admin to reconcile it before the pallet can be used again.',
          },
        }
      }
      if (superseded > 0) {
        ;({ error: insErr } = await insertRow())
        // Success -> a fresh 'pending' row is ours; fall through to the normal first-run
        // path. Still failing (lost the post-supersede race to another new op, or the write
        // genuinely broke) -> `ex` stays null and the classifier below returns the right
        // 409/500. A SAME-key retry never reaches here: its own row is found by key, so
        // `ex` is set and the existing failed_pre_erp resume path handles it as before.
        if (!insErr) {
          ex = null
          // Adopt the abandoned reservation so our finalize() re-stages the pallet. Written
          // before any ERP work, so even if THIS op dies too, the snapshot lives on and the
          // next attempt inherits it in turn.
          if (inheritedSnapshot) {
            const { error: snapErr } = await LOG()
              .update({ reservation_snapshot: inheritedSnapshot })
              .eq('idempotency_key', key)
            if (snapErr) {
              // FAIL CLOSED. We now hold the family lock but do NOT know the pallet owes
              // itself back to an order. Proceeding would mutate the pallet and finish
              // "clean" while it stays detached from its Sales Order. Retire our own row
              // (releasing the lock) and refuse — the debt is still recorded on the row we
              // superseded, and the next attempt inherits it again.
              await LOG()
                .update({ status: 'failed', error: `could not inherit reservation snapshot: ${snapErr.message}` })
                .eq('idempotency_key', key)
              return {
                status: 503,
                body: { error: 'Could not safely take over a previous failed operation on this pallet; try again.' },
              }
            }
          }
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
    } else if (ex.status === 'failed_pre_erp') {
      // Before re-running ERP, confirm it really didn't commit (a post-commit
      // checkpoint failure can also land here). If it did, resume; never re-run.
      if (reconcile) {
        const r = await reconcile()
        if (r) {
          committed = r
          await LOG()
            .update({ status: 'erp_committed', batch: r.batch ?? null, erp_stock_entry: r.stockEntry ?? null })
            .eq('idempotency_key', key)
        }
      }
      if (!committed) {
        // Atomically claim the retry (compare-and-swap on status) so two
        // concurrent retries can't both proceed to re-run ERP.
        const { data: claimed } = await LOG()
          .update({ status: 'pending', error: null })
          .eq('idempotency_key', key)
          .eq('status', 'failed_pre_erp')
          .select('idempotency_key')
        if (!claimed || claimed.length === 0) {
          return { status: 409, body: { error: 'Operation is being retried; try again shortly' } }
        }
      }
    } else {
      // pending — try to reconcile against ERP before refusing.
      if (reconcile) {
        const r = await reconcile()
        if (r) {
          committed = r
          await LOG()
            .update({ status: 'erp_committed', batch: r.batch ?? null, erp_stock_entry: r.stockEntry ?? null })
            .eq('idempotency_key', key)
        }
      }
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
      await LOG()
        .update({ status: 'failed_pre_erp', error: msg.slice(0, 500), failed_at: new Date().toISOString() })
        .eq('idempotency_key', key)
      return { status: 502, body: { error: `${action} failed: ${msg.slice(0, 200)}` } }
    }
    committed = r
    // Best-effort checkpoint. If THIS write fails the row stays 'pending';
    // a retry's reconcile() will detect the committed ERP doc and resume —
    // it must NOT be treated as a pre-ERP failure (that would duplicate stock).
    await LOG()
      .update({ status: 'erp_committed', batch: r.batch ?? null, erp_stock_entry: r.stockEntry ?? null })
      .eq('idempotency_key', key)
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
      await LOG().update({ warning }).eq('idempotency_key', key).then(undefined, () => undefined)
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
      await LOG()
        .update({ status: 'done', batch: committed.batch ?? null, erp_stock_entry: committed.stockEntry ?? null, error: `label: ${msg.slice(0, 400)}`, ...(warning ? { warning } : {}) })
        .eq('idempotency_key', key)
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
  await LOG()
    .update({
      status: 'done',
      print_job_id: printJobId,
      batch: committed.batch ?? null,
      erp_stock_entry: committed.stockEntry ?? null,
      // Persist the warning on the TERMINAL write too. The earlier update is best-effort;
      // if it failed and this one omitted the warning, a lost-response retry would replay
      // the row as a clean success while the pallet is still off its order.
      ...(warning ? { warning } : {}),
    })
    .eq('idempotency_key', key)
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
