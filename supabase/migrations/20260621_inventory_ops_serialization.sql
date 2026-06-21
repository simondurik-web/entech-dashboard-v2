-- Inventory Ops — operation log + Stage 3 serialization support.
--
-- inventory_ops_log was originally created out-of-band in earlier sessions; this migration
-- is self-contained (CREATE TABLE IF NOT EXISTS) so a fresh database is reproducible from
-- the repo, then layers on the serialization-era columns + the concurrency lock.
--
-- The log is the idempotency/state machine for every inventory write (see
-- lib/erpnext/operation.ts runInventoryOp): pending -> erp_committed -> done, or
-- failed_pre_erp if the ERP phase threw before committing.
--
-- Serialization (see docs/inventory-ops.md): a reprint or qty change REISSUES a pallet as
-- the next serial in its family (D79C -> D79C-02) and disables the old batch.
--   * result_batch — the reserved next serial for a reissue op, persisted so a retry
--     reuses it instead of allocating a fresh one.
--   * family       — the pallet family root (palletBase: the serial with any "-NN" suffix
--     stripped). One physical pallet = one family.
--   * inventory_ops_active_family_uniq — ATOMIC "one active op per pallet family" lock. A
--     reissue mutates BOTH the old serial and the new serial, so the guard covers the
--     whole family, not a single batch. It also covers failed_pre_erp: a half-finished
--     reissue keeps holding the lock (a second op can't run on the family) until the
--     original is retried to completion or an admin clears the row. Two concurrent ops on
--     any serial of the same family can't both insert; the loser hits a unique violation
--     (23505) which runInventoryOp surfaces as a clean 409.

CREATE TABLE IF NOT EXISTS inventory_ops_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  action          text NOT NULL,
  item_code       text,
  qty             numeric,
  warehouse       text,
  station_id      text,
  batch           text,
  erp_stock_entry text,
  print_job_id    uuid,
  status          text NOT NULL DEFAULT 'pending',
  error           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  result_batch    text,
  family          text
);

-- Idempotent column adds for databases where the table predates the serialization columns.
ALTER TABLE inventory_ops_log ADD COLUMN IF NOT EXISTS result_batch text;
ALTER TABLE inventory_ops_log ADD COLUMN IF NOT EXISTS family text;

-- Backfill family for existing rows. Match the runtime palletBase() EXACTLY: strip the
-- "-NN" serial suffix only when the root is the Crockford base32 alphabet (0-9, A-Z minus
-- I/L/O/U) and the suffix is 2+ digits; otherwise keep the whole code (legacy hyphenated
-- names like "FOO-12" stay "FOO-12", never mis-grouped/under-locked).
UPDATE inventory_ops_log
   SET family = CASE
                  WHEN batch ~ '^[0-9A-HJKMNP-TV-Z]+-[0-9]{2,}$'
                    THEN regexp_replace(batch, '-[0-9]{2,}$', '')
                  ELSE batch
                END
 WHERE family IS NULL AND batch IS NOT NULL;

-- Supersede any earlier batch-scoped index from out-of-band application.
DROP INDEX IF EXISTS inventory_ops_active_batch_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_ops_active_family_uniq
    ON inventory_ops_log (family)
 WHERE status IN ('pending', 'erp_committed', 'failed_pre_erp') AND family IS NOT NULL;
