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
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_since timestamptz;

COMMENT ON COLUMN inventory_ops_log.reservation_snapshot IS
  'Staging reservation captured BEFORE the op released it: {"so","warehouse","qty"}. Lets a retry restore a pallet to its Sales Order if the op died mid-flight. NULL = the pallet was not staged.';

COMMENT ON COLUMN inventory_ops_log.warning IS
  'Non-fatal problem that outlived the op, e.g. reservation_transfer_failed = stock moved but the pallet is no longer staged to its order. Persisted so an idempotent retry re-surfaces it.';

COMMENT ON COLUMN inventory_ops_log.pending_since IS
  'When the row last ENTERED the pending state (insert, retry-claim, or reclaim). An abandoned pending row is only reclaimable once this is old. It must NOT be aged on created_at: a legitimate retry CASes a long-lived row back to pending, and created_at would make it look instantly stale — letting a second request run erp() concurrently with the first. That is duplicate stock.';

COMMENT ON COLUMN inventory_ops_log.failed_at IS
  'When this row LAST entered failed_pre_erp. The age gate before superseding a dead op must use this, not created_at: an old row that just timed out again is freshly ambiguous (its ERPNext write may still land), and created_at would wave it straight through.';

-- BACKFILL — without this the fix does nothing for the jams that motivated it.
-- The supersede age gate filters holders with `failed_at < now() - 15min`. In SQL a NULL
-- comparison is never true, so every pre-existing failed_pre_erp row (the ones actually
-- jamming pallets today) would be invisible to it and stay jammed forever. Their last
-- failure clock therefore starts now (see the pending_since note below for why not
-- created_at).
UPDATE inventory_ops_log
   SET failed_at = now()
 WHERE failed_at IS NULL
   AND status IN ('failed_pre_erp', 'failed');

-- Stamp from now(), NOT created_at: rows are REUSED across retries, so a long-lived row that
-- is retrying at this very moment would look instantly stale and could be superseded or
-- reclaimed while its ERPNext write is still in flight — duplicate stock. Starting the clock
-- at migration time costs one safety interval and is always correct.
UPDATE inventory_ops_log
   SET pending_since = now()
 WHERE pending_since IS NULL
   AND status = 'pending';

-- Keep the table service-role-only, and make that explicit in the repo.
--
-- reservation_snapshot is TRUSTED: the server reads it back and reserves real stock to the
-- Sales Order it names. A Data API client (the anon/authenticated key ships in the browser)
-- must never be able to write it, or it could point a pallet at a Sales Order of its
-- choosing and quietly re-allocate someone else's stock. Nothing legitimate touches this
-- table from the client — every inventory op goes through a server route on the service role.
--
-- The live DB already has RLS enabled here with no policies, and anon/authenticated hold no
-- SELECT/INSERT/UPDATE (only the inert REFERENCES/TRIGGER auto-grants). These statements are
-- therefore a no-op today; they exist so the guarantee is declared in the repo and survives
-- a future table rebuild. (REVOKE alone would not be enough on Supabase: new tables get
-- auto-grants to anon/authenticated via pg_default_acl, so revoke those roles explicitly.)
--
-- Deliberately NOT using FORCE ROW LEVEL SECURITY: postgres and service_role both have
-- BYPASSRLS, so FORCE buys nothing — while quietly changing the rules for the owner role
-- that maintenance scripts (e.g. clearing a jam) connect as.
ALTER TABLE inventory_ops_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_ops_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE inventory_ops_log TO service_role;


-- Atomic hand-off of a jammed pallet family from a dead op to its replacement.
--
-- THE RACE THIS CLOSES (the last review blocker, 2026-07-14):
-- Retiring a dead `failed_pre_erp` holder and claiming its pallet family used to take three
-- round-trips from the app: UPDATE the holder to 'failed' (which RELEASES the family lock,
-- because the partial unique index `inventory_ops_active_family_uniq` only covers
-- pending/erp_committed/failed_pre_erp), INSERT our own row, then copy the holder's
-- reservation_snapshot onto it. Between the first two statements the family is UNLOCKED, so
-- a second request can slip in and claim it — and it would not carry the snapshot, i.e. the
-- Sales Order the pallet still owes itself back to. The pallet then completes its operation
-- "cleanly" while permanently detached from its order.
--
-- Doing it inside one function makes it one transaction: the holder is retired, the
-- successor is inserted, and the debt is inherited, all or nothing. A loser of the race hits
-- the unique index and gets NULL back instead of a half-done hand-off.
--
-- SAFETY: the caller must ALREADY have proven p_clean_key is safe to retire —
-- ERP committed nothing under it (no Stock Entry stamped [op:key]) and its failure is old
-- enough that a timed-out submit has certainly settled. This function does not re-check
-- that; it only guarantees atomicity. It refuses to touch anything not in that list.

CREATE OR REPLACE FUNCTION supersede_and_claim_family(
  p_key         text,
  p_action      text,
  p_created_by  uuid,
  p_family      text,
  p_clean_key   text,
  p_failed_at   timestamptz,
  p_item_code   text DEFAULT NULL,
  p_qty         numeric DEFAULT NULL,
  p_warehouse   text DEFAULT NULL,
  p_station_id  text DEFAULT NULL,
  p_batch       text DEFAULT NULL,
  p_result_batch text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_retired  int;
  v_now      timestamptz := now();  -- one stamp for the insert AND the returned lease
BEGIN
  -- Retire every dead holder the caller vetted, keeping any reservation debt they carry.
  -- The CAS on status = 'failed_pre_erp' means a same-key retry that just claimed its row
  -- back to 'pending' (and may be re-running ERP right now) is never stomped.
  WITH retired AS (
    UPDATE inventory_ops_log
       SET status = 'failed',
           error  = coalesce(error, '') || ' | superseded by ' || p_key || ' (no ERP commit under this key)'
     WHERE family = p_family
       AND status = 'failed_pre_erp'
       AND idempotency_key = p_clean_key
       AND idempotency_key <> p_key
       -- VERSION CHECK. We proved ERP was clean under this key at a moment when its
       -- failed_at was exactly p_failed_at. A same-key retry can meanwhile flip it
       -- failed_pre_erp -> pending -> failed_pre_erp, re-running ERP and possibly
       -- committing stock; that restamps failed_at. Matching on the old value means such a
       -- row NO LONGER MATCHES and is left alone — we never retire an operation that came
       -- back to life and touched ERP after our probe. (codex BLOCKER, final round.)
       AND failed_at = p_failed_at
    RETURNING reservation_snapshot
  )
  SELECT count(*), max(reservation_snapshot::text)::jsonb
    INTO v_retired, v_snapshot
    FROM retired
   WHERE true;

  IF v_retired = 0 THEN
    RETURN NULL; -- nothing of ours to retire; caller falls back to the normal conflict path
  END IF;

  -- Claim the family. Inherit the debt in the SAME statement that takes the lock, so there
  -- is no instant where the family is claimable without it. If a racing request beat us to
  -- the index, this raises unique_violation and the whole transaction (including the
  -- retirement above) rolls back — the jam is left exactly as it was for the next attempt.
  INSERT INTO inventory_ops_log
    (idempotency_key, action, status, created_by, family,
     item_code, qty, warehouse, station_id, batch, result_batch, reservation_snapshot,
     pending_since)
  VALUES
    (p_key, p_action, 'pending', p_created_by, p_family,
     p_item_code, p_qty, p_warehouse, p_station_id, p_batch, p_result_batch, v_snapshot,
     -- MUST be stamped. A pending row with a NULL pending_since can never be aged, so a
     -- crash during erp() would lock this family forever — a new permanent jam, created by
     -- the very path that exists to clear jams.
     v_now);

  -- Return the stamped pending_since as 'lease' so the caller uses it DIRECTLY as its lease,
  -- with no separate readback. A readback could transient-fail and leave the caller with a
  -- null lease (unguarded terminal writes — round-19 should-fix). (`::text` = ISO 8601, which
  -- is what the JS layer compares pending_since against.)
  RETURN jsonb_build_object('retired', v_retired, 'inherited_snapshot', v_snapshot, 'lease', v_now::text);

EXCEPTION
  -- Lost the race: someone else claimed the family (or reused our key) between our read and
  -- our insert. The handler rolls this block back — INCLUDING the retirement above — so the
  -- dead holder keeps holding the family and its reservation debt stays recorded on it. The
  -- caller sees NULL and takes the ordinary "another operation is in progress" path; the
  -- next attempt re-runs the whole hand-off cleanly. Never a half-done supersede.
  WHEN unique_violation THEN
    RETURN NULL;
END;
$$;

-- Server-side only: this retires operations and moves reservation debt around.
REVOKE ALL ON FUNCTION supersede_and_claim_family(text, text, uuid, text, text, timestamptz, text, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION supersede_and_claim_family(text, text, uuid, text, text, timestamptz, text, numeric, text, text, text, text) TO service_role;

-- The old array signature would otherwise linger as an overload.
DROP FUNCTION IF EXISTS supersede_and_claim_family(text, text, uuid, text, text[], text, numeric, text, text, text, text);
