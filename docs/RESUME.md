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
  - `fix(inventory-ops): keep ops-log qty stable for retry idempotency`
  - `feat(inventory-ops): bulk bin transfer (scan-to-queue) + optional delete reason`
  - `feat(inventory-ops): Add-panel bin selector is now a single combobox`
  - `docs: document Locations view, reports, mobile nav`
  - `feat: Locations view + bin/product/full reports`

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
   search). Larger By-bin dropdown.
8. **Dropdown scroll fix** — the page uses Lenis smooth-scroll, which hijacks the wheel
   globally; inner scroll lists need the **`data-lenis-prevent`** attribute (NOT a wheel
   handler — that doesn't work). Applied to all four inventory dropdown lists (part, bin,
   add-item, move-bin). Remember this for any future scrollable dropdown on a Lenis page.
9. **Label timestamp fix** — labels stamped UTC because routes used new Date().toLocaleString()
   with no timeZone (Vercel runs UTC). Fixed via shared `labelTimestamp()` in lib/erpnext/label.ts
   forcing `America/Detroit`; used by add/adjust/reprint. (Heads-up for any other server-side
   user-facing time.)
10. **Recently-printed-labels panel** — `/api/erpnext/inventory/recent-labels?limit=N` (default
    10, clamp 1..50): last N print_jobs + printer (print_stations name/location) + purpose
    (action from inventory_ops_log via the `print-<opKey>` link) + who + status. Panel at the
    bottom of inventory-ops (both views), expand 10→50, refetched after add/adjust/reprint.
    Flags a not-printed-within-3-min job as "Stuck — check printer" (jam/offline detection).
11. **Add-panel bin combobox** — replaced the filter-input + native select with one combobox
    (addWarehouse = committed value submitAdd uses; whFilter = box text; whOpen). Click→all
    bins, type→filter, focus selects-all, blur reverts unconfirmed text to the committed bin.
    Option buttons use `onMouseDown preventDefault` so a pick doesn't blur the input (avoids a
    stale-revert timer desync — the bug the agents caught). Add button gated on item+bin+qty+station.
12. **Bulk bin transfer (new Transfer tab)** — third view toggle. Pick the destination bin
    once (shared `BinCombobox`), then scan or type pallet IDs into a queue (continuous
    `PalletScanner` with a 2.5s same-code cooldown; Enter on the text input adds too). Each
    add does a `/pallet-lookup` (current serial, item, current bin, qty) so the queue only
    holds valid, not-already-at-dest pallets; dedup by batch. **Post Transfer** moves the
    whole queue in ONE atomic ERPNext Material Transfer (multi-row Stock Entry,
    `lib/erpnext/inventory.ts:bulkTransfer`). Shows the last transfer (dest + count + who +
    when) via `/last-transfer`. Endpoints: `/bulk-transfer` (POST), `/pallet-lookup` (GET),
    `/last-transfer` (GET). Bilingual.
    - **Idempotency:** `runInventoryOp` with `action:'bulk-transfer'`, `family:null`
      (a bulk move spans many pallets so it can't take the per-pallet family lock; a move
      doesn't reissue serials so that lock isn't needed — worst case a concurrent
      reissue/remove makes this transfer's atomic Stock Entry fail at submit, a clean
      re-postable failure, never a silent double-move). Retry reconciles by finding the
      `[op:key]`-stamped Stock Entry.
    - **Identity binding:** `meta.item_code` = JSON-encoded sorted unique batch set
      (delimiter-safe fingerprint), so reusing a key with a different pallet set is rejected.
    - **GOTCHA (4-agent review caught this):** do NOT overwrite `inventory_ops_log.qty` with
      the actual moved count — `qty` is part of `runInventoryOp`'s identity check, so a
      lost-response retry of a *partial* transfer (moved < queued) would falsely 409. `qty`
      stays = queued count; skips are near-zero anyway (queue is pre-validated at scan time).
      Fresh-post response still returns exact `moved`/`skipped` to the UI.
13. **Optional delete reason** — removing a label/pallet still prompts for a reason, but you
    can now click OK with it blank (faster); only Cancel aborts. `submitRemove` proceeds on
    empty, aborts only on `prompt() === null`; `/remove` route treats `reason` as optional.
15. **Non-serialized (quantity) items** — items with `has_batch_no=0` (the fixed packs:
    CURB-36PK / EB-48PK families, 20 SKUs, converted in ERPNext while at 0 stock) are tracked
    as a plain quantity per bin, in BOXES (1 stock unit = 1 box). The Add panel branches on the
    batch flag server-side: a non-batch receive posts a Material Receipt (no batch) and prints a
    GENERIC label (part # + pack size + QR of the PART NUMBER, one copy per box via ZPL `^PQ`,
    capped 9999 = the receive cap). The By-item card shows per-bin Move/Remove quantity controls
    instead of pallet rows. Lib: `qtyReceive`/`qtyTransfer`/`qtyRemove`/`getItemInfo`/`getItemBins`/
    `packSize`; routes `qty-transfer`, `qty-remove`; `qty-remove` + `restore` are office-only.
    Order-based shipping stays in ERPNext. To convert more SKUs: set `has_batch_no=0` on the Item
    (clean only at 0 stock / 0 ledger entries) — script pattern in `/tmp/convert_nonbatch.py`
    (bench: `~/frappe-bench/env/bin/python`, run from `~/frappe-bench/sites`, site `erp.local`).
16. **Scan a deleted/zeroed pallet** — `lookupRemovedPallet` + the locate route return a removed
    pallet's data (part, last label qty, last bin, history) when its family has no active stocked
    serial, so a scan shows it at 0 instead of vanishing.
17. **Restore a deleted pallet** — scan → "Return to inventory". Same qty as the label re-enables
    the SAME serial (no new label); a different qty reissues a NEW serial + new label (confirm
    first). Lib `restorePallet` (asserts 0 on-hand before re-receipting, gated on a fresh op so
    retries stay idempotent), route `/restore`. The "label qty" = the batch's `custom_pallet_qty`;
    the restore bin defaults to the last warehouse from the Stock Ledger Entry.
18. **Part dropdown** shows only the part number (description was often a duplicate / boilerplate).
    Reviewer note: the remove/qty-remove `reason` is sanitized (`safeRemark`, strips `[]`) before
    it enters Stock Entry remarks, so it can't smuggle an `[op:<key>]` token that would poison
    `reconcileStockEntry`'s LIKE match.

14. **Inventory Operations role permission** — `/inventory-ops` is now a toggleable row in
    `admin/permissions` ("Inventory Operations"), so access can be granted per role. The whole
    enforcement stack already keyed off this path (nav filter, AccessGuard, the page gate, AND
    the server-side `requireInventoryAccess` guard at `lib/erpnext/auth.ts:67` on every API
    route) — only the admin toggle row was missing. Admin/super_admin always have access.

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
