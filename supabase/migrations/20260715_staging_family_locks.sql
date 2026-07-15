-- Staging joins the per-pallet-family lock (closes review blocker #1, 2026-07-14).
--
-- THE RACE THIS CLOSES:
-- Inventory ops serialize on the partial unique index inventory_ops_active_family_uniq —
-- one active op row per pallet family. Staging (reserving pallets to a Sales Order) only
-- *read* that index: it refused pallets with an active op, but the read was TOCTOU and the
-- staging op row itself carried family = NULL (it spans many pallets). So an op could
-- acquire a family and release order A's reservation *after* staging's read, and staging
-- could then reserve the briefly-free pallet to order B. The op detects the theft and
-- warns — but the stock has already moved.
--
-- The fix: staging takes the SAME lock the ops use, for every family it touches, in one
-- atomic statement. It inserts one MARKER row per family (action 'stage-lock', status
-- 'pending') — the partial unique index either admits all of them or the whole claim rolls
-- back. Markers are pure lock rows: nothing ever executes under their keys (no erp() run,
-- no stock document is ever stamped with them), which is what makes it safe to retire a
-- stale one — unlike a real op row, there is no in-flight work a retirement could race.
--
-- Marker lifecycle:
--   claim_staging_families    -> markers 'pending' (the lock is HELD). Re-claiming bumps
--                                pending_since (the lease) and a holder refcount in `qty`;
--                                same-key requests share the markers.
--   release_staging_families  -> markers 'cancelled' once the LAST holder releases (qty
--                                refcount) and the main op row isn't mid-flight
--   stale retire              -> markers 'cancelled' (crashed staging; age-gated far beyond
--                                the function's maxDuration, in claim_staging_families for
--                                staging-vs-staging and in runInventoryOp for op-vs-staging)
-- 'cancelled' keeps markers out of every reader: pallet history / locate / last-transfer
-- select done|erp_committed, the friendly route pre-checks select active statuses, and the
-- partial unique index drops the row the instant it leaves 'pending'.

-- One marker per family a staging request touches, all-or-nothing.
--
-- p_pallets: jsonb array [{"family": "...", "batch": "..."}] — batch is the scanned serial,
-- recorded on the marker for a readable busy message and for the ops-log UI.
--
-- Returns {"ok": true} when every family is locked by THIS key (freshly inserted, revived,
-- or already held by an earlier attempt of the same key — the runInventoryOp row serializes
-- actual execution, so sharing the lock between same-key attempts is safe).
-- Returns {"ok": false, "busy": [{family, batch, action}...]} when any family is actively
-- held by someone else; nothing is changed in that case.
CREATE OR REPLACE FUNCTION claim_staging_families(
  p_key        text,
  p_created_by text,
  p_so         text,
  p_pallets    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busy jsonb;
BEGIN
  -- The key feeds LIKE patterns below; the route validates this shape too, but a LIKE
  -- metacharacter slipping through would let one key match another's markers. '-fam-' is
  -- the marker-key separator itself: a key containing it would make key K's LIKE pattern
  -- match key "K-fam-X"'s markers (round-17 should-fix).
  IF p_key !~ '^[A-Za-z0-9-]{8,64}$' OR position('-fam-' IN p_key) > 0 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  -- Retire stale FOREIGN markers first. A staging request that crashed (process killed
  -- mid-function) can never release its markers; without this, its pallets would be
  -- un-stageable forever. 15 minutes is far beyond the route's maxDuration (120s), so a
  -- marker this old cannot belong to a still-executing request. The id-subquery with
  -- ORDER BY + FOR UPDATE takes the row locks in a deterministic order, so two claims
  -- retiring overlapping stale sets can't deadlock each other (gemini, round 16).
  UPDATE inventory_ops_log
     SET status = 'cancelled',
         error  = coalesce(error, '') || ' | stale stage-lock retired by ' || p_key
   WHERE id IN (
     SELECT id FROM inventory_ops_log
      WHERE action = 'stage-lock'
        AND status = 'pending'
        AND pending_since < now() - interval '15 minutes'
        AND idempotency_key NOT LIKE p_key || '-fam-%'
        AND family IN (SELECT e->>'family' FROM jsonb_array_elements(p_pallets) e)
      ORDER BY family
        FOR UPDATE
   );

  -- Touch EVERY marker of ours in the requested set, whatever its status:
  --   * already 'pending'  -> REFRESH pending_since (the lease) and count another holder.
  --     Round-16 BLOCKER (all three reviewers, independently): without the refresh, a
  --     same-key retry >15 min after a crash runs under markers whose age says "stale" —
  --     any concurrent op or claim would retire them MID-STAGING and re-open the theft
  --     window. An age gate only works if every claim that will execute bumps the lease.
  --   * retired ('cancelled'/'failed'/...) -> REVIVE to 'pending'. idempotency_key is
  --     UNIQUE unconditionally — not just in the partial index — so re-INSERTing the same
  --     marker key would violate it; flip the row back instead. If a foreign ACTIVE row
  --     meanwhile holds the family, this UPDATE itself trips the partial unique index and
  --     the whole claim rolls back — the index guards updates exactly like inserts.
  --
  -- qty doubles as a HOLDER REFCOUNT (markers have no quantity; the column is free).
  -- Same-key requests deliberately SHARE markers, so release must know when the last
  -- sharer is done: each claim increments, each release decrements, only zero releases
  -- (codex/grok round-16 should-fix — an early-exiting duplicate must not free the locks
  -- under a sibling that is still executing). A revive resets the count to 1: the row was
  -- retired, so whoever held it before is gone by definition.
  UPDATE inventory_ops_log
     SET pending_since = now(),
         error         = NULL,
         qty           = CASE WHEN status = 'pending' THEN coalesce(qty, 1) + 1 ELSE 1 END,
         status        = 'pending'
   WHERE action = 'stage-lock'
     AND idempotency_key IN (
       SELECT p_key || '-fam-' || (e->>'family') FROM jsonb_array_elements(p_pallets) e
     );

  -- Take the remaining locks: one marker per family this key does not hold yet (the UPDATE
  -- above already re-claimed every existing own row, so NOT EXISTS here means "no row at
  -- all"). If ANY family is actively held by another key, the partial unique index raises
  -- and everything above rolls back too — an all-or-nothing claim, never a partial lock set.
  INSERT INTO inventory_ops_log
    (idempotency_key, action, status, family, batch, warehouse, created_by, pending_since, qty)
  SELECT p_key || '-fam-' || (e->>'family'),
         'stage-lock', 'pending',
         e->>'family', e->>'batch', p_so, p_created_by, now(), 1
    FROM jsonb_array_elements(p_pallets) e
   WHERE NOT EXISTS (
     SELECT 1 FROM inventory_ops_log h
      WHERE h.idempotency_key = p_key || '-fam-' || (e->>'family')
   )
   -- Deterministic insert order: two concurrent claims over overlapping families would
   -- otherwise wait on each other's speculative inserts in opposite order — a deadlock
   -- (40P01) instead of the clean unique_violation the caller handles.
   ORDER BY e->>'family';

  RETURN jsonb_build_object('ok', true);

EXCEPTION WHEN unique_violation THEN
  -- Lost to an active holder. The block above has rolled back; report who is in the way so
  -- the API can name the busy pallet instead of a bare "try again".
  SELECT jsonb_agg(jsonb_build_object('family', h.family, 'batch', h.batch, 'action', h.action))
    INTO v_busy
    FROM inventory_ops_log h
   WHERE h.family IN (SELECT e->>'family' FROM jsonb_array_elements(p_pallets) e)
     AND h.status IN ('pending', 'erp_committed', 'failed_pre_erp')
     AND h.idempotency_key NOT LIKE p_key || '-fam-%';
  RETURN jsonb_build_object('ok', false, 'busy', coalesce(v_busy, '[]'::jsonb));
END;
$$;

-- Release one holder's share of a staging request's markers. Two guards decide whether the
-- markers actually free (round-16 panel findings):
--
--   * REFCOUNT (qty): same-key requests deliberately share markers, and they can diverge —
--     one early-exits on a validation 409 while its sibling is still reserving. Releasing
--     on the early exit would free the locks under the live sibling, re-opening the theft
--     window. Every claim increments qty, every release decrements it, and only the LAST
--     holder (qty reaches 0) cancels the markers. A crashed holder leaks its count; the
--     15-min stale retire is the backstop, exactly as for any crashed request.
--
--   * MAIN-ROW STATUS: never cancel while the main op row is pending/erp_committed — a
--     worker is (or may be) still executing the reserve itself, whatever the refcount says.
--     Absent or terminal main row + zero refcount = genuinely done.
CREATE OR REPLACE FUNCTION release_staging_families(p_key text) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_main_status text;
  v_released    int;
BEGIN
  IF p_key !~ '^[A-Za-z0-9-]{8,64}$' OR position('-fam-' IN p_key) > 0 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  -- Drop this holder's share first, unconditionally: even when the main row blocks the
  -- cancel below, the count must reflect that this request is gone.
  UPDATE inventory_ops_log
     SET qty = greatest(coalesce(qty, 1) - 1, 0)
   WHERE action = 'stage-lock'
     AND status = 'pending'
     AND idempotency_key LIKE p_key || '-fam-%';

  SELECT status INTO v_main_status FROM inventory_ops_log WHERE idempotency_key = p_key;
  -- KEEP the locks held whenever the staging op is still executing OR RETRYABLE. `failed_pre_erp`
  -- is retryable: a same-key retry resumes and RE-RUNS staging ERP — if we cancelled its markers
  -- here it would run without family locks, reopening the staging-vs-inventory theft race
  -- (round-20 codex BLOCKER). Treat it exactly like pending/erp_committed.
  IF v_main_status IN ('pending', 'erp_committed', 'failed_pre_erp') THEN
    RETURN 0;
  END IF;

  -- Main op is genuinely finished (done / cancelled) or never existed. Free the markers only
  -- when the LAST holder has released (refcount reached 0) — NEVER pull locks out from under a
  -- live same-key sibling. A crashed sibling that leaked its increment keeps the markers a
  -- little longer; the 15-min stale retire is the backstop (it never causes a theft, only a
  -- brief extra hold on already-staged pallets). This is the ONLY cancel path — the previous
  -- "terminal main row cancels regardless of refcount" branch was the theft-race reopener.
  UPDATE inventory_ops_log
     SET status = 'cancelled'
   WHERE action = 'stage-lock'
     AND status = 'pending'
     AND coalesce(qty, 0) <= 0
     AND idempotency_key LIKE p_key || '-fam-%';
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN v_released;
END;
$$;

-- Server-side only, like supersede_and_claim_family: these move the pallet lock around.
REVOKE ALL ON FUNCTION claim_staging_families(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_staging_families(text, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION release_staging_families(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION release_staging_families(text) TO service_role;
