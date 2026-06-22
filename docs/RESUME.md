# Resume / handoff — Inventory Ops (as of 2026-06-22)

Quick-start for picking this up after a context reset. **Source of truth for the
inventory module is [`docs/inventory-ops.md`](./inventory-ops.md)** — read it first.

## Where the code is
- Working branch: **`feat/label-redesign`** (in the git worktree
  `~/clawd/projects/entech-dashboard-v2-pallet`). Everything is committed and **pushed to
  `origin/staging`** (the backup; Vercel auto-deploys staging). `main` is NOT updated —
  Simon reviews staging first, then we promote (working agreement: never push `main`
  without staging validation + his OK).
- Latest staging commits (newest first):
  - `docs: document Locations view, reports, mobile nav`
  - `fix(nav): collapsible sections in the iPhone/mobile drawer`
  - `feat: Locations view + bin/product/full reports`
  - `feat: inline pallet actions (drop Manage-pallets expander)`
  - `feat: Stage 3 serialization (reissue on reprint + qty change)`

## What shipped (all on staging, awaiting Simon's review)
1. **Stage 3 serialization** — reprint/qty-change reissues a pallet as the next serial
   (D79C→D79C-02), disables the old; atomic one-op-per-family lock; fully resumable. See
   inventory-ops.md "Serialization".
2. **Inline pallet actions** — pallet rows show their action buttons inline (no
   "Manage pallets" expander).
3. **Locations view** — By item / By bin toggle; bin combo-box → bin contents.
4. **Reports** — single bin (CSV+PDF), single product (CSV+PDF), full inventory
   (.xlsx, By Bin + By Product AutoFilter tabs, incl. pallet IDs). Bilingual.
5. **Mobile nav** — collapsible accordion sections in the iPhone drawer (matches desktop).
6. **Bin-view pallet actions** — the Locations (By bin) view now has the same per-pallet
   actions as By item (edit/reprint/remove/transfer/history) via a shared `renderPalletRow`;
   `refreshAfterMutation` + `switchView` keep both views fresh and guard the loadBin race.
7. **By-item part-number dropdown** — focusing the search opens a dropdown of all stockable
   parts (`/items?all=1` → `listAllItems`, fetched once, filtered as you type, select to
   search). Larger + scrollable By-bin dropdown (added the wheel-scroll handler the Add/part
   pickers use — fixes the hover-can't-scroll bug; reused on the part dropdown too).

## Live infra changes already applied (entech-production Supabase, project ref mqfjmzqeccufqhisqpij)
- `inventory_ops_log` gained `result_batch` + `family` columns and the partial unique index
  `inventory_ops_active_family_uniq` (status in pending/erp_committed/failed_pre_erp).
  Captured in `supabase/migrations/20260621_inventory_ops_serialization.sql` (self-contained).
- Mgmt API token: `~/clawd/secrets/supabase-access-token.json`; SQL via
  `POST https://api.supabase.com/v1/projects/<ref>/database/query`.

## Pending / next (Simon's backlog, in rough order)
1. **Attach to Sales Order** at add time (searchable SO field; prints on label).
2. **Weight + Dimensions** capture at print (optional; under pallet id on label).
3. **Audit feature** (future) — structured count-verification flow built on the bin/full reports.
4. Optimize the full-inventory export for very large facilities (server-stream the xlsx
   instead of building it all in browser memory) — only if it bites.
5. Add-form idempotency key: mint a fresh key when the qty/payload is edited (server already
   rejects a changed-payload reuse safely; this is a UX nicety).

## How we work here (so reviews stay consistent)
- Every change runs through the **4-agent review** before staging: Codex (`codex exec
  --skip-git-repo-check "..." < /dev/null`), Grok (`grok --file <f> "..."`), Gemini
  (`handoff gemini "..."` — give it a focused prompt / let it read files; it times out on
  huge diffs), and Opus (me). Fix BLOCK/HIGH, re-review until findings narrow to MED/LOW.
- Verify with `npx tsc --noEmit` + `npm run build` (the build's only failure locally is
  `supabaseUrl is required` at page-data collection — that's missing local env, NOT a code
  bug; it builds fine on Vercel).
- Bilingual rule: every user-facing string ships EN+ES in the same commit (`locales/*.json`).
- Report/audit philosophy: completeness > speed; fail loudly, never silently omit data.
