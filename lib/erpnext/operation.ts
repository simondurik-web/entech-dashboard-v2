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
}

export interface RunOpResult {
  status: number
  body: Record<string, unknown>
}

const LOG = () => supabaseAdmin.from('inventory_ops_log')

export async function runInventoryOp(args: RunOpArgs): Promise<RunOpResult> {
  const { key, action, createdBy, meta, erp, reconcile, label } = args
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) {
    return { status: 400, body: { error: 'invalid idempotencyKey' } }
  }
  let committed: Committed | null = null

  // Reserve the key.
  const { error: insErr } = await LOG().insert({
    idempotency_key: key,
    action,
    status: 'pending',
    created_by: createdBy,
    ...meta,
  })

  if (insErr) {
    const { data: ex } = await LOG()
      .select('status, action, family, batch, item_code, station_id, qty, warehouse, erp_stock_entry, print_job_id, error')
      .eq('idempotency_key', key)
      .maybeSingle()
    if (!ex) {
      // No row for THIS key, yet the insert still hit a unique violation -> it tripped the
      // partial unique index on `family` (an active op already holds this pallet family).
      // This is the atomic backstop for the same-pallet concurrency guard: refuse cleanly.
      if (insErr.code === '23505') {
        return { status: 409, body: { error: 'Another operation is in progress for this pallet; try again shortly.' } }
      }
      return { status: 500, body: { error: 'operation log conflict' } }
    }

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

  // ERP phase (skipped when resuming an erp_committed row).
  if (!committed) {
    let r: Committed
    // ONLY an erp() throw means nothing committed -> failed_pre_erp.
    try {
      r = await erp()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await LOG().update({ status: 'failed_pre_erp', error: msg.slice(0, 500) }).eq('idempotency_key', key)
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
        .update({ status: 'done', batch: committed.batch ?? null, erp_stock_entry: committed.stockEntry ?? null, error: `label: ${msg.slice(0, 400)}` })
        .eq('idempotency_key', key)
      return {
        status: 200,
        body: {
          ok: true,
          labelPending: true,
          batch: committed.batch,
          stockEntry: committed.stockEntry,
          message: 'Stock recorded; label print failed — use Reprint.',
        },
      }
    }
  }

  // Persist batch + stock entry again on the final write: the mid-flight erp_committed
  // checkpoint is best-effort (its failure is swallowed), and for a reissue that's where
  // `batch` flips from the old serial to the new one. Writing it here too guarantees the
  // row ends up pointing at the committed (new) serial even if the checkpoint was lost.
  await LOG()
    .update({ status: 'done', print_job_id: printJobId, batch: committed.batch ?? null, erp_stock_entry: committed.stockEntry ?? null })
    .eq('idempotency_key', key)
  return {
    status: 200,
    body: { ok: true, batch: committed.batch, stockEntry: committed.stockEntry, printJobId },
  }
}
