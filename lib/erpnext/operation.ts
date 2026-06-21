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
      .select('status, batch, erp_stock_entry, print_job_id')
      .eq('idempotency_key', key)
      .single()
    if (!ex) return { status: 500, body: { error: 'operation log conflict' } }

    if (ex.status === 'done') {
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          batch: ex.batch,
          stockEntry: ex.erp_stock_entry,
          printJobId: ex.print_job_id,
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
      await LOG().update({ error: `label: ${msg.slice(0, 400)}` }).eq('idempotency_key', key)
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

  await LOG().update({ status: 'done', print_job_id: printJobId }).eq('idempotency_key', key)
  return {
    status: 200,
    body: { ok: true, batch: committed.batch, stockEntry: committed.stockEntry, printJobId },
  }
}
