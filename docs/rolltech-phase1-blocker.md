# Phase 1 Blocker — Queue View Modification

**Status:** Blocked — needs Simon's input before proceeding
**Date:** 2026-04-09

---

## What's done

The `action_center_overrides` table migration is ready:
- `supabase/migrations/20260409_action_center_overrides.sql`
- Append-only audit log, indexed on `(thread_key, performed_at DESC)`
- RLS enabled with service_role full access policy
- Follows repo migration conventions (see `bom_audit`, `labels` patterns)

## What's blocked

**Cannot update `v_action_center_queue` view** because:

1. **No view definition exists in this repo.** The `work_email` schema is managed externally — all migrations in `supabase/migrations/` operate on `public` schema tables only.

2. **View type unknown.** If `v_action_center_queue` is a materialized view, the override JOIN strategy differs (need `REFRESH MATERIALIZED VIEW` trigger or cron vs. live JOIN).

3. **Source tables/columns unknown.** To write the `CREATE OR REPLACE VIEW` with the override LEFT JOIN, we need the full current view definition.

## What Simon needs to provide

1. **Current view definition:** Run this in Supabase SQL Editor:
   ```sql
   SELECT pg_get_viewdef('work_email.v_action_center_queue', true);
   ```
   If that errors with "not a view", try:
   ```sql
   SELECT definition FROM pg_matviews 
   WHERE schemaname = 'work_email' 
     AND matviewname = 'v_action_center_queue';
   ```

2. **Confirm view type:** Regular view or materialized view?

3. **Write permissions:** Confirm the dashboard's `SUPABASE_SERVICE_ROLE_KEY` can INSERT into `work_email` schema tables.

## What happens next

Once we have the view definition:
- We write `CREATE OR REPLACE VIEW` with a LEFT JOIN to `action_center_overrides`
- Latest override per `thread_key` (by `performed_at DESC`) replaces the original `queue_bucket` via `COALESCE`
- Existing threads without overrides are unaffected
- This unblocks Phase 2 (wiring the mutate route to real writes)
