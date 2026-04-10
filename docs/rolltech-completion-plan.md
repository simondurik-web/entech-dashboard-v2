# RollTech Action Center — Completion Plan

> Generated 2026-04-09 · Staging-only rollout · Production gate requires Simon's sign-off

---

## Current State (verified from repo)

| Layer | Status | Notes |
|-------|--------|-------|
| Queue read (list) | **LIVE** | `GET /api/rolltech-actions` → `work_email.v_action_center_queue` |
| Thread detail read | **LIVE** | `GET /api/rolltech-actions/[threadKey]` → same view, `.single()` |
| Digests read | **STUB** | `GET /api/rolltech-actions/digests` queries `v_action_center_daily_digest` / `v_action_center_weekly_digest` — returns `null` gracefully when views don't exist |
| Quick actions (mutate) | **DRY-RUN** | `POST /api/rolltech-actions/mutate` validates payload, logs, returns `{ dry_run: true }`. No DB write. |
| UI (page + components) | **WIRED** | page.tsx, BucketRail, ActionList, ActionDetail, QuickActions, DigestPreview all functional. Optimistic local update in `onMutate` already coded. |
| Signal extractor | **BUILT (external)** | `scripts/signal-extract.py` referenced in plan prompt but not present in this repo. Needs ingest-pipeline wiring in the DB/ETL layer. |
| Types | **SOLID** | `types.ts` covers ActionRecord, DailyDigest, WeeklyDigest, all bucket/priority/signal enums |

---

## Phase Plan

### Phase 1 — Supabase Write Table + RLS (DB work, no dashboard code)

**Goal:** Create the write-side table that `mutate` will INSERT into.

**Tasks:**
1. Create `work_email.action_center_overrides` table:
   ```
   id              uuid PK default gen_random_uuid()
   thread_key      text NOT NULL
   action_type     text NOT NULL  -- target queue_bucket
   performed_by    text NOT NULL  -- 'dashboard:<user>' or 'system'
   performed_at    timestamptz NOT NULL default now()
   note            text          -- optional free-text
   previous_bucket text          -- snapshot of old bucket for audit
   ```
2. Add index on `(thread_key, performed_at DESC)`.
3. Create RLS policy: service-role full access (dashboard uses `supabaseAdmin`).
4. Update `v_action_center_queue` view to reflect the latest override per thread_key (LEFT JOIN + COALESCE on queue_bucket).

**Acceptance criteria:**
- INSERT into `action_center_overrides` from SQL client succeeds.
- `v_action_center_queue` returns the overridden bucket for that thread.
- Existing threads without overrides are unaffected.

**Risks/blockers:**
- Need confirmation of `work_email` schema write permissions for the Supabase service role key used by dashboard.
- Must confirm whether `v_action_center_queue` is a regular view or materialized — if materialized, overrides need a different join strategy or a refresh trigger.

**Parallelizable:** No — this is a dependency for Phase 2.

---

### Phase 2 — Wire Mutate Route to Real DB Writes

**Goal:** Replace dry-run with actual INSERT. Keep dry-run toggle for safety.

**Tasks:**
1. In `app/api/rolltech-actions/mutate/route.ts`:
   - Add `supabaseAdmin` import.
   - Read current record's `queue_bucket` (for `previous_bucket` audit field).
   - INSERT into `work_email.action_center_overrides`.
   - Return `{ ok: true, dry_run: false }`.
2. Add env flag `ROLLTECH_MUTATE_DRY_RUN=true` (default true). Only perform real writes when explicitly set to `false`.
3. After successful write, the next GET will reflect the change via the updated view (Phase 1).

**Acceptance criteria:**
- With `DRY_RUN=true`: existing behavior unchanged.
- With `DRY_RUN=false`: clicking a quick action persists to DB, next page refresh shows new bucket.
- Error on invalid thread_key (no matching record).

**Risks/blockers:**
- Latency of view refresh if `v_action_center_queue` is materialized.
- Need to decide: should multiple overrides for same thread accumulate (audit log) or upsert (latest wins)? Recommend: accumulate (append-only), view picks latest.

**Parallelizable:** No — depends on Phase 1.

---

### Phase 3 — Digest Views in Supabase (DB work, parallelizable with Phase 2)

**Status: MIGRATION READY** — `supabase/migrations/20260409_action_center_digests.sql`

**Goal:** Create the two digest views so the existing `/api/rolltech-actions/digests` route returns real data.

**Tasks:**
1. ~~Create `work_email.v_action_center_daily_digest` view~~ ✅ Done — sections grouped by queue_bucket, ordered by BUCKET_CONFIG priority
2. ~~Create `work_email.v_action_center_weekly_digest` view~~ ✅ Done — at_risk, new_business, throughput, noise_report, open_commitments
3. ~~Both views return a single row matching TypeScript types exactly~~ ✅ All column names verified against DailyDigest/WeeklyDigest interfaces
4. Helper function `work_email._digest_item()` builds DigestItem JSONB from queue records

**Acceptance criteria:**
- `GET /api/rolltech-actions/digests` returns non-null `daily_digest` and `weekly_digest`.
- DigestPreview component renders real data without code changes.
- Daily view shows correct section counts matching queue bucket counts.

**Known limitations (by design):**
- Weekly `throughput.newly_resolved_count` → NULL (no `resolved_at` column in source view)
- Weekly `throughput.new_thread_count` → NULL (no `first_seen_at` column in source view)
- Weekly `throughput.newly_resolved_threads` → empty array (same reason)
- All three already typed as `number | null` / handled gracefully in UI
- DigestItem `risk_reasons` field omitted (optional in TypeScript, UI renders without it)

**Parallelizable:** YES — can run in parallel with Phase 2 (different DB objects, no dependency).

---

### Phase 4 — Signal Extractor Ingest Pipeline Wiring (DB/ETL, parallelizable)

**Goal:** Wire the deterministic signal extractor into the email processing pipeline so signals are populated automatically.

**Tasks:**
1. Locate `signal-extract.py` (external repo or local — needs Simon's confirmation on location).
2. Wire it as a step in the email ingest pipeline (likely a Supabase Edge Function or cron trigger).
3. Ensure extracted signals are written to the `signals` JSONB array column on the base action records table.
4. Validate that `v_action_center_queue` surfaces the updated signals.

**Acceptance criteria:**
- New emails processed through the pipeline have signals populated.
- Existing records can be backfilled with a one-time script run.
- Signal badges render correctly in ActionDetail.

**Risks/blockers:**
- Signal extractor location unknown in this repo — need Simon to confirm.
- Pipeline architecture (Edge Function vs. external cron vs. pg_cron) needs decision.

**Parallelizable:** YES — independent of Phases 2-3. Can be worked on by a separate agent.

---

### Phase 5 — UI Polish & Live-Write UX

**Goal:** Remove dry-run indicators, add confirmation UX, handle write errors.

**Tasks:**
1. Remove "Dry run" badge from QuickActions when `DRY_RUN=false`.
2. Add toast/notification on successful mutation (e.g., "Moved to Ready to Process").
3. Add error toast on mutation failure.
4. Add confirmation dialog for destructive actions (e.g., moving to "Resolved" or "Noise").
5. Auto-refetch queue data after successful mutation (replace optimistic-only with optimistic + revalidate).
6. Update subtitle text in page.tsx from "quick actions are dry-run only" to live status.

**Acceptance criteria:**
- User sees feedback on every action (success or error).
- Destructive moves require confirmation.
- Queue data is consistent within 2s of mutation.

**Parallelizable:** YES — UI work, can be done by a frontend agent in parallel with Phase 4.

---

### Phase 6 — Staging Validation & Smoke Tests

**Goal:** End-to-end validation on staging before production gate.

**Tasks:**
1. Manual smoke test checklist:
   - [ ] Queue loads with real data from `v_action_center_queue`
   - [ ] Bucket rail counts match actual records
   - [ ] Search filters correctly across customer, PO, part numbers
   - [ ] Thread detail loads fresh data on selection
   - [ ] Quick action moves thread to new bucket (persists across refresh)
   - [ ] Audit trail: `action_center_overrides` has correct entry
   - [ ] Daily digest renders with real sections
   - [ ] Weekly digest renders with KPI grid and at-risk items
   - [ ] Error states: API down, invalid thread, network failure
   - [ ] Mobile: bucket tabs, slide-out detail panel
2. Optional: Add API route integration tests (Jest/Vitest) for mutate and digests endpoints.

**Acceptance criteria:**
- All checklist items pass on staging.
- No console errors in browser or server logs.

**Parallelizable:** No — requires all prior phases complete.

---

### GATE: Production Rollout (requires Simon's explicit approval)

After Phase 6 passes on staging:
1. Set `ROLLTECH_MUTATE_DRY_RUN=false` in production env.
2. Verify digest views exist in production Supabase.
3. Monitor for 24h: error rates, override audit trail, signal population.

**This phase does NOT proceed without Simon's sign-off.**

---

## Dependency Graph

```
Phase 1 (DB: write table)
  └─► Phase 2 (API: real writes)
        └─► Phase 5 (UI: live-write UX) ──► Phase 6 (Staging validation)
                                                └─► GATE: Production
Phase 3 (DB: digest views) ─────────────────►─┘
Phase 4 (ETL: signal extractor) ────────────►─┘
```

## Parallel Agent Strategy

| Wave | Phases | Agent Assignment |
|------|--------|-----------------|
| Wave 1 | Phase 1 | Agent A (DB/SQL) |
| Wave 2 | Phase 2 + Phase 3 + Phase 4 | Agent A (mutate API), Agent B (digest views), Agent C (signal pipeline) |
| Wave 3 | Phase 5 | Agent D (frontend) |
| Wave 4 | Phase 6 | Manual + any agent |

**Max parallelism: 3 agents** during Wave 2.

---

## Pre-Flight Confirmations Needed from Simon

Before starting Phase 1:
1. **Write permissions:** Does the Supabase service role key (`supabaseAdmin`) have INSERT access to `work_email` schema?
2. **View type:** Is `v_action_center_queue` a regular view or materialized view?
3. **Signal extractor location:** Where is `scripts/signal-extract.py`? Is it in a separate repo?
4. **Override semantics:** Append-only audit log (recommended) or last-write-wins upsert?
5. **Digest data sources:** Do the base tables have `first_seen_at` / `resolved_at` columns for weekly throughput metrics?
