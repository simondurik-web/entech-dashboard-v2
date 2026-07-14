-- Inventory ops: remember a pallet's staging reservation across a failed/retried op.
--
-- WHY (production incident, 2026-07-14):
-- ERPNext v15 refuses to move or reissue RESERVED stock, so any op on a staged pallet
-- must release its Stock Reservation Entry first, mutate, then re-reserve. Until now the
-- "which Sales Order was this pallet staged to" identity lived ONLY in the request
-- closure. If the op died between the release and the re-reserve — crash, timeout, lost
-- response, or a reconcile-resume that skips erp() entirely — that identity was gone. The
-- retry saw no reservation, re-ran happily, and returned success. The pallet had SILENTLY
-- fallen off its Sales Order, and the order would ship short with nobody warned.
-- (All three review models blocked the fix without this.)
--
-- Snapshot the reservation on the op row BEFORE releasing it, so any later attempt can put
-- it back. `warning` persists an unstaged-pallet warning so an idempotent replay of a lost
-- response still surfaces it instead of reporting a clean success.
--
-- Additive and reversible: both columns are nullable, nothing reads them for existing rows,
-- no backfill, no lock beyond a catalog update.

ALTER TABLE inventory_ops_log
  ADD COLUMN IF NOT EXISTS reservation_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS warning text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

COMMENT ON COLUMN inventory_ops_log.reservation_snapshot IS
  'Staging reservation captured BEFORE the op released it: {"so","warehouse","qty"}. Lets a retry restore a pallet to its Sales Order if the op died mid-flight. NULL = the pallet was not staged.';

COMMENT ON COLUMN inventory_ops_log.warning IS
  'Non-fatal problem that outlived the op, e.g. reservation_transfer_failed = stock moved but the pallet is no longer staged to its order. Persisted so an idempotent retry re-surfaces it.';

COMMENT ON COLUMN inventory_ops_log.failed_at IS
  'When this row LAST entered failed_pre_erp. The age gate before superseding a dead op must use this, not created_at: an old row that just timed out again is freshly ambiguous (its ERPNext write may still land), and created_at would wave it straight through.';

-- BACKFILL — without this the fix does nothing for the jams that motivated it.
-- The supersede age gate filters holders with `failed_at < now() - 15min`. In SQL a NULL
-- comparison is never true, so every pre-existing failed_pre_erp row (the ones actually
-- jamming pallets today) would be invisible to it and stay jammed forever. Their last
-- failure is, in practice, when they were created.
UPDATE inventory_ops_log
   SET failed_at = created_at
 WHERE failed_at IS NULL
   AND status IN ('failed_pre_erp', 'failed');

-- Lock the table down to the service role.
--
-- reservation_snapshot is TRUSTED: the server reads it back and reserves real stock to the
-- Sales Order it names. If a Data API client (anon/authenticated key, which ships in the
-- browser) could write this table, it could point a pallet at a Sales Order of its choosing
-- and quietly re-allocate somebody else's stock. Nothing legitimate touches this table from
-- the client — every inventory op goes through the server routes on the service role.
-- (REVOKE alone is not enough on Supabase: new tables get auto-grants to anon/authenticated
-- via pg_default_acl, so revoke from those roles explicitly.)
ALTER TABLE inventory_ops_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_ops_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_ops_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE inventory_ops_log TO service_role;
-- No policies are defined on purpose: with RLS on and no policy, non-service roles can read
-- and write nothing. The service role bypasses RLS, so the server keeps working unchanged.
