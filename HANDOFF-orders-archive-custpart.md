# HANDOFF — Orders Data: Archived toggle + Customer Part # column

**Written 2026-07-13 ~21:55 EDT by claude-3.** If the session was cut off, this file + the git branch contain everything needed to finish. Simon is asleep; he expects this LIVE ON PRODUCTION (main) with verification screenshots in #molding-dashboard by morning.

## The ask (Simon, Discord #molding-dashboard 2026-07-13 20:30 EDT, msg 1526385386392125603)
1. A **button on Orders Data to hide archived orders** (the pre-ERPNext Fusion archive rows, which merge into the table during search and were drowning out live orders — see his screenshot with ARCHIVED badges).
2. A **"Customer Part #" column** — **optional, NOT default**; users who want it add it via the Columns picker. Must be *mapped properly* (customer's own part number per line).
3. Process he explicitly required: **test with the 4 agents** (4-model review panel), **screenshot to verify** the archive filter works and the customer part number displays/maps properly, **push to main**, and **verify main and staging are the same**.

## State of the work

- **Worktree:** `/Users/simondurik/clawd/projects/orders-archive-custpart` (repo entech-dashboard-v2)
- **Branch:** `feat/orders-archive-toggle-customer-part`, based on `0a90f38` (= staging = main at start; that commit is the earlier shipped-filter fix, already verified on prod)
- **Commits (all build+tsc clean, `npx next build` passes):**
  - `c8443f1` — both features + new API route + locale keys (EN+ES)
  - `91ffbbe` — use-data-table: reconcile on columnOrder replacement (self-review catch)
  - `28ee1d6` — panel fixes: paginate mappings feed past max_rows; chip keys off archiveCat

## What was built (files)

- `app/(dashboard)/orders/page.tsx`
  - `showArchived` state (default true) + chip `🗄 Archived` rendered after the status chips **only when** `search.trim().length >= 2 && archiveCat.length > 0`. Off → `tableData` returns `browseFiltered` (archive never merges).
  - Background fetch of `/api/customer-part-numbers` → `custPartByKey` Map keyed `` `${customer.toLowerCase()}::${internalPart.toLowerCase()}` ``.
  - `enrichCustomerPart` stamps `customerPartNumber` onto order + archive rows (real field → sort/filter/search/CSV all work; DataTable reads `row[col.key]`).
  - New ColumnDef `customerPartNumber`, `defaultHidden: true`, placed between Customer and Part # (insertion logic puts it there for existing users too).
- `app/api/customer-part-numbers/route.ts` (NEW) — slim feed `{customer, internalPart, customerPart}` from Supabase `customer_part_mappings` + `customers(name)`; gate `requireReadAccess` (same as `/api/orders-archive`); paginates in ordered 1000-row pages (PostgREST max_rows caps single responses at 1000 on this project); deliberately excludes pricing tiers.
- `lib/use-data-table.ts` — the missing-column reconciliation effect now depends on `[columns, columnOrder]` and adds newly-introduced `defaultHidden` keys to `hiddenColumns`. Reason: the server prefs GET (`user_table_prefs`) or `applyView` can replace order+hidden with copies that predate the column → without this the new column pops **visible far-right** for anyone with saved prefs. Doesn't set prefsDirty (reconciliation ≠ user edit). No render loop: after reconciliation inserts the key, `missing` is empty.
- `locales/en.json` + `locales/es.json` — `orders.archivedChip`, `orders.archivedChipHint`, `table.customerPart` (3 keys each, same commit).

## Data facts (verified against live Supabase)
- `customer_part_mappings`: 596 rows, **zero duplicate (customer, internal_part) pairs**, `customer_part_number` sometimes null (route filters those out). `id` uuid column exists (used for stable page ordering).
- Join = customer **name** (case-insensitive) + internal part — same resolution as `lib/erpnext/customer-part.ts` (packing slip / po-bot). Coverage check: 3,773 of 3,942 dashboard_orders rows resolve; misses are genuinely unmapped (show "-").
- Fusion archive table: `dashboard_orders_fusion_archive`, ~3.8k rows, ~95% Shipped/Invoiced.

## 4-model review status (Simon requires this before push)
- **Run 1** (run dir `~/clawd/logs/review-panel/runs/20260713-204130-d4c975bb/`): codex=SHIP, gemini=SHIP, grok=SHIP, **0 blockers**. SHOULD-FIXes: (a) prefs/applyView race → fixed `91ffbbe`; (b) max_rows pagination → fixed `28ee1d6`; (c) chip archiveCat → fixed `28ee1d6`. My own leg-4 pass had independently caught (a).
- **Run 2 (final diff, for the review-gate stamp)**: RUNNING at handoff time (background task b9xgtjlaj; diff = `~/clawd/logs/review-panel/diff-orders-archive-custpart-final.diff`, 285 lines, sha stamp required by the pre-push `review-gate` hook for the EXACT diff bytes `git diff 0a90f38 HEAD`). If it was lost: re-run `~/clawd/bin/review-panel <that-diff> "<context from ~/clawd/logs/review-panel/context-orders-archive-custpart.txt>"` and wait for all-SHIP.

## Remaining steps (in order)
1. Confirm run 2 verdicts all-SHIP (check the newest dir in `~/clawd/logs/review-panel/runs/` or the reviews.tsv scoreboard). Fix any BLOCKER + re-stamp if one appears (a model BLOCK may not be silently downgraded).
2. Push: `cd /Users/simondurik/clawd/projects/orders-archive-custpart && git push origin HEAD:staging` (fast-forward from 0a90f38). The smoke-gate hook fires — **delete any stale `/tmp/smoke-gate/<session>.json` BEFORE pushing** and read the fresh verdict (last time a stale PASS from the previous push nearly slipped through).
3. Browser-verify on the canonical staging URL `https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/orders`:
   - Auth: **Supabase admin magic-link session mint** — see memory `reference_supabase_magiclink_headless_dashboard_auth` (generate_link with service key from repo `.env.local` → `/auth/v1/verify` with anon key → localStorage `sb-mqfjmzqeccufqhisqpij-auth-token` on that origin → reload; REVOKE after with `/auth/v1/logout?scope=local`, NEVER global).
   - Checks: search "Toter" → ARCHIVED rows present with chip on; click 🗄 Archived chip → they disappear (counter drops); chip absent when search box empty. Columns picker → enable "Customer Part #" → verify values against `customer_part_mappings` for a few rows (e.g. Toter LLC internal `616.261.191`, and one Origen RV / Martin Wheel row); unmapped rows show "-". Column must be OFF by default (also verify with the stored-prefs path: the `dt-hidden-orders` localStorage of a fresh profile vs one with saved order). No console errors. **Screenshots** (desktop; a mobile-width one is a plus) → send to Simon.
4. Push main: `git push origin <sha>:main` (fast-forward), smoke gate again, verify GitHub deployment `environment=Production` state=success (`gh api repos/simondurik-web/entech-dashboard-v2/deployments?sha=...`), spot-check behavior on `https://entech-dashboard-v2.vercel.app/orders`, confirm `git rev-parse origin/main origin/staging` identical.
5. Update `~/clawd/projects/molding/CONTEXT.md` Recent Activity + this file's status line; Discord reply to #molding-dashboard (chat_id 1475224563389300878) with screenshots, prefix `[claude-3 · <model>]`.
6. Cleanup: remove worktree `git worktree remove /Users/simondurik/clawd/projects/orders-archive-custpart` + delete branch after merge confirmed.

## Gotchas already hit this session
- Vercel MCP rate-limits; the CLI token in `~/Library/Application Support/com.vercel.cli/auth.json` is INVALID (`invalidToken`) — use `gh api` deployments or the smoke-gate verdict instead.
- Chrome-devtools MCP browser has NO cookies; use the magic-link mint (above), re-inject per origin.
- `tsc --noEmit` shows 2 pre-existing errors in `lib/*.test.ts` (TS5097) — ignore, they're on the base commit too.
- Supabase REST single responses cap at 1000 rows regardless of Range header (project max_rows) — paginate.
