# Sales Action Center — Handoff Document
> Generated 2026-04-10 · For use by any coding agent continuing this feature

---

## What This Feature Is

A live email queue dashboard for `rolltech.sales@4entech.com` emails.
Emails are AI-processed and stored in Supabase (`work_email` schema), then displayed
as an actionable queue with buckets, a detail panel, quick action buttons, and digest summaries.

**Production URL:** https://entech-dashboard-v2.vercel.app/rolltech-actions
**Staging URL:** https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/rolltech-actions
**Repo:** `~/clawd/projects/entech-dashboard-v2`
**Branch workflow:** feature → staging → main (pre-push hook guards staging)

---

## Current State (as of 2026-04-10)

| Layer | Status | Notes |
|-------|--------|-------|
| Queue read (list) | ✅ LIVE | 504 threads from `work_email.v_action_center_queue` |
| Thread detail read | ✅ LIVE | Per-thread enrichment working |
| UI — BucketRail, ActionList, ActionDetail, QuickActions, DigestPreview | ✅ DONE | All wired, no code changes needed |
| Permission guard | ✅ DONE | Visitors blocked; only explicit role access |
| Quick Actions mutate route | ✅ CODE DONE | Route tries to INSERT into `action_center_overrides` — **fails silently because table doesn't exist yet** |
| Digest views | ✅ SQL WRITTEN | Migration file exists — **not yet run in Supabase** |
| Override table | ✅ SQL WRITTEN | Migration file exists — **not yet run in Supabase** |
| Queue view with override join | ✅ SQL WRITTEN | Migration file exists — **not yet run in Supabase** |

**Bottom line: dashboard code is 100% done. Only 3 SQL migrations need to be run.**

---

## What's Left — Ordered by Priority

### 🔴 P1 — Run the 3 SQL Migrations (unlocks everything)

**All 3 files are in:** `supabase/migrations/`

Run them **in this exact order** in Supabase SQL editor
(Dashboard → SQL Editor → paste each file → Run):

#### Step 1: Create the override write table
**File:** `supabase/migrations/20260409_action_center_overrides.sql`

This creates `work_email.action_center_overrides` — the append-only audit log
where Quick Action clicks get stored. Once this exists, the mutate API route
will start writing real data immediately (no code changes needed).

#### Step 2: Replace the queue view to read overrides
**File:** `supabase/migrations/20260409_action_center_queue_override_join.sql`

This replaces `work_email.v_action_center_queue` with a version that LEFT JOINs
the latest override per thread. When a user clicks "Resolve", the thread moves
buckets and stays there after refresh.

⚠️ **Warning:** This replaces an existing view. If the current view was created
differently than expected, this may error. Run it and check for errors before
declaring success. The key query at the end is:
```sql
GRANT SELECT ON work_email.v_action_center_queue TO service_role;
```
Make sure that line runs without error.

#### Step 3: Create the digest views
**File:** `supabase/migrations/20260409_action_center_digests.sql`

Creates:
- `work_email._digest_item()` — helper function
- `work_email.v_action_center_daily_digest` — daily summary view
- `work_email.v_action_center_weekly_digest` — weekly summary view

Once this runs, the Digest tab will show real data with zero code changes.

---

### 🟡 P2 — Fix Supabase Site URL (manual config, 2 min)

**Location:** Supabase Dashboard → Authentication → URL Configuration

**Current (wrong):** `https://snappad-portal.vercel.app`
**Should be:** `https://entech-dashboard-v2.vercel.app`

Impact: If a user logs in on a fresh browser with no redirect param, they land on
SnapPad after authentication instead of the dashboard. Low severity — only affects
first-time login on browsers that don't remember the redirect.

**Do this manually in the Supabase web dashboard. Do not touch via API.**

---

### 🟡 P3 — Wire Search/Filter on Queue (code change needed)

The search input on the queue page (`/rolltech-actions`) has a placeholder but is not
wired to filter the thread list.

**File:** `app/(dashboard)/rolltech-actions/page.tsx`
**Hook:** `lib/rolltech-action-center/use-action-center.ts`

Look for the `search` state variable. It needs to be passed into the hook and used
to filter `threads` client-side (or as a query param on the API if server-side is preferred).

Fields to search against (already in `ActionRecord` type):
- `thread_subject`
- `customer_name`
- `action_summary`
- `reference_numbers.po_numbers[]`
- `reference_numbers.quote_numbers[]`

---

### 🟢 P4 — Thread Action History Timeline (code + DB, after P1)

Once overrides are writing to `action_center_overrides`, add a history section to
the detail panel showing: who moved this thread, when, and from what bucket.

**API needed:** New route `GET /api/rolltech-actions/thread/[id]/history`
```ts
// Query: SELECT * FROM work_email.action_center_overrides
//        WHERE thread_key = :id ORDER BY performed_at DESC
```

**UI:** Add a collapsible "Action History" section at the bottom of `ActionDetail.tsx`.

---

### 🟢 P5 — Date Range Filter on Digest Tab (code, after P2 digest views are live)

The digest tab currently shows only today/this week. Add a date picker to browse
historical digests. This requires storing digest snapshots (the views compute live,
they don't store history), so this is a larger DB design task.

---

## Key Files

```
app/(dashboard)/rolltech-actions/
  page.tsx                          ← main page, wires all components

app/api/rolltech-actions/
  route.ts                          ← GET /api/rolltech-actions (queue list)
  [threadKey]/route.ts              ← GET /api/rolltech-actions/:key (detail)
  digests/route.ts                  ← GET /api/rolltech-actions/digests
  mutate/route.ts                   ← POST /api/rolltech-actions/mutate ← READY, needs DB table

components/rolltech-action-center/
  ActionList.tsx                    ← thread list
  ActionDetail.tsx                  ← right panel (detail + quick actions)
  BucketRail.tsx                    ← bucket tabs (Reply Today / Internal / etc.)
  DigestPreview.tsx                 ← daily + weekly digest tabs
  QuickActions.tsx                  ← action buttons in detail panel

lib/rolltech-action-center/
  use-action-center.ts              ← main hook (data fetch, state, mutations)
  types.ts                          ← all TypeScript types (ActionRecord, QueueBucket, etc.)
  seed-data.json                    ← fallback seed for dev without DB

lib/
  use-permissions.ts                ← permission check — PATH_FALLBACKS is intentionally empty
  supabase-admin.ts                 ← server-side Supabase client (service_role)

supabase/migrations/
  20260409_action_center_overrides.sql          ← P1 Step 1 — RUN THIS FIRST
  20260409_action_center_queue_override_join.sql ← P1 Step 2 — RUN THIS SECOND
  20260409_action_center_digests.sql            ← P1 Step 3 — RUN THIS THIRD
```

---

## Supabase Schema

**Project:** `mqfjmzqeccufqhisqpij.supabase.co`
**Schema:** `work_email`

### Existing tables/views (already live)
- `work_email.actions` — source of truth for email thread records
- `work_email.action_events` — individual email events per thread
- `work_email.v_action_center_queue` — current queue view (will be replaced by migration Step 2)

### Tables/views to be created by migrations
- `work_email.action_center_overrides` — write table for Quick Actions (Step 1)
- `work_email.v_action_center_queue` — replaced with override-aware version (Step 2)
- `work_email.v_action_center_daily_digest` — daily digest (Step 3)
- `work_email.v_action_center_weekly_digest` — weekly digest (Step 3)
- `work_email._digest_item()` — helper function (Step 3)

---

## QueueBucket Values (valid `action_type` values for mutate)

```ts
"needs_reply_today"
"needs_internal_decision"
"ready_to_process"
"shipping_release_coordination"
"waiting_on_customer"
"needs_review"
"resolved"
"noise"
```

---

## Testing After Migrations

1. **Quick Actions write test:**
   - Open a thread in staging, click any Quick Action button
   - Toast should say "Moved to [bucket]" (not "Dry run")
   - Refresh page — thread should still be in the new bucket
   - Verify in Supabase: `SELECT * FROM work_email.action_center_overrides ORDER BY performed_at DESC LIMIT 5`

2. **Digest test:**
   - Open the Digest tab — should show real bucket counts, not "not yet available"
   - `SELECT * FROM work_email.v_action_center_daily_digest` should return 1 row with non-null sections

3. **Permission test (incognito):**
   - Open staging in incognito — "Sales Action Center" should NOT appear in sidebar
   - Navigate directly to `/rolltech-actions` — should see "You do not have permission"

---

## Deployment Workflow Reminder

```
feature branch → staging (requires agent review via .clawdbot/review-pr.sh)
staging → main (no hook, but always ask Simon before pushing)
main → production via: vercel --prod (from ~/clawd/projects/entech-dashboard-v2)
```

Pre-push hook only gates `staging`. Main can be pushed freely, but **always get Simon's approval first**.

---

## Contact / Ownership

- **Simon Durik** — Product owner, must approve all production pushes
- **Supabase project:** `mqfjmzqeccufqhisqpij` (same project used by all dashboard features)
- **Vercel team:** `simons-projects-849cf04c`
- **Last updated:** 2026-04-10 by Marco
