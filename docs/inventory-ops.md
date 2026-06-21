# Inventory Ops — spec & decisions (source of truth)

Living reference for the Inventory Ops module (`/inventory-ops`). Keep this in sync
whenever the label, pallet-id scheme, scanner, or actions change — Simon's standing
rule (2026-06-21): **be super consistent; never lose the label templates or these
decisions across dashboard/ERPNext updates.** Update this doc in the same commit as
any change here.

## Pallet ID scheme
- Short **Crockford base32** codes (`0-9 A-Z` minus `I L O U`), generated in
  `lib/erpnext/inventory.ts` → `generatePalletId()`.
- Starts at **4 chars** (~1M), **auto-grows** to 5/6 when a length saturates. No
  migration; different-length codes never collide. Uniqueness enforced against the
  live ERPNext Batch table. The pallet id IS the ERPNext Batch name.
- The dashboard service user can read/write stock+batches but CANNOT delete or edit
  Item masters (those need admin/bench).

## Label template — `lib/erpnext/label.ts` (`buildPalletZpl`)
- **ZT411, 4x6 @ 203dpi.** Head is 4in (812 dots) wide, feeds the 6in (1218) length.
- **Landscape**: head can't print 6in wide, so the layout is rotated 90° — all text
  uses `^A0R`; coordinates are in "reading" terms (media-Y = reading width).
- **NO company name or logo** (company is being renamed; name-free labels never need
  relabeling).
- Fields, reading top → down: `PART No.` + internal part number (prominent),
  description, `QTY: n pcs`, `PALLET` + the pallet id (directly under QTY), then
  optional rows (Weight, Dimensions, Sales Order, Customer) shown only when provided.
- **QR**: rendered as a scalable `^GFA` bitmap from the `qrcode` lib (no native ^BQ
  size cap). Pattern sized to ~2.5in; **error-correction H** (a short code is a 21×21
  v1 symbol, so H adds robustness at no size cost). Payload = the bare pallet code.
- **Generated date/time** + **printed-by name** print in the scan zone (replaced the
  old "SCAN PALLET" caption). Stamped server-side at print time by the route (the
  user name is resolved from `user_profiles`).
- TODO (later, agreed): Weight + Dimensions under the pallet id; reprint
  serialization (see Open/pending).

## Print pipeline
- Dashboard (Vercel) builds ZPL and enqueues a `print_jobs` row (Supabase) for a
  `print_stations` station. The shop mini's `print-agent.py` polls, claims, and prints
  raw ZPL (`lp -d ZT411 -o raw`). Every add/adjust always enqueues a label.

## Scanner — `components/inventory/PalletScanner.tsx`
- ZXing over `getUserMedia` (works on iOS Safari; native BarcodeDetector isn't there).
  Rear camera; loaded `ssr:false`.
- **Decode reliability**: `TRY_HARDER` hint, 1920×1080 feed requested, continuous
  autofocus constraint, decode a centre crop at native resolution (no upscale blur).
- **Zoom**: hardware zoom (OS-sharp) to its full max, plus up to 4× digital crop on
  top; pinch + slider + live "Nx" readout. (Browser zoom is less than the native
  Camera app's max; high zoom needs a few feet of distance to focus.)
- Cosmetic sniper-scope **reticle** overlay (purely visual).

## Actions / endpoints (`app/api/erpnext/inventory/*`)
- `locate` — search by part number/name → item cards + bins, with the pallet ids
  shown inline under each bin (for stocked items). An **exact** pallet-id query
  (typed or scanned) returns ONLY that pallet's item (`matchedPallet`) and the UI
  auto-opens + highlights it — never a fuzzy multi-part list (safety).
- `add` — Material Receipt + Batch + mandatory label; idempotent (ops-log state
  machine, retry-safe).
- `adjust` — correct a pallet qty (delta receipt/issue) + reprint label.
- `remove` — issue-out + disable batch (office roles); cancel-not-delete.
- `move` — Material Transfer of a pallet to another bin; logged as `move` (shows in
  history). No label reprint (location isn't on the label).
- `reprint` — re-enqueue a pallet's label to a printer; no stock change; logged as
  `reprint` (shows in history); idempotent per key.
- `pallets` — list on-hand pallets for an item.
- `history` — **traceability**: per-pallet timeline from `inventory_ops_log` (every
  op stamps `created_by` + `created_at`); UI derives qty/bin transitions from order.

## Traceability / user attribution
- `inventory_ops_log` (Supabase) records every action with `created_by`, `created_at`,
  `action`, `qty`, `warehouse`, `batch`, `status`. This is the audit source.

## Open / pending (in build order)
1. **Reprint serialization** (safety) — to prevent two physical labels with the same
   id, each reprint supersedes the previous: the printed/QR code carries a version
   suffix (e.g. `D79C-02`), only the LATEST is valid, and scanning/searching an older
   version warns/blocks. Tracked dashboard-side (the ERPNext Batch name stays the
   same); mirrors the old Fusion behavior.
2. **Attach to Sales Order** at add time (searchable SO field; prints on the label).
3. **Weight + Dimensions** capture at print (optional; under the pallet id on label).
4. **Locations view** — toggle to search a bin and list its contents.

Done: search/locate, add, adjust, remove, list pallets, history (traceability),
**bin Move**, **Reprint**, generated date/time on label, scanner zoom + reticle.

## 4-agent review findings (2026-06-21: Codex/GPT-5.5, Grok/Composer-2.5, Gemini-Ultra, Opus) — hardening backlog

STAGE 1 DONE (shipped): stable per-(action,pallet) idempotency keys on adjust/move/
remove/reprint; `assertBatchItem` guard (batch belongs to item + active) on adjust/
remove/move/reprint; Move preflights the destination warehouse; reprint validates
batch active + qty>0 and has a reconcile (no stuck pending); fresh search data wins the
pallet-cache merge; label upserts are insert-or-ignore (no reprint of a printed job).
2nd review round (incremental, all 4 agents) caught + FIXED regressions: idempotency
key now binds the payload (changed qty/dest/station mints a fresh key); label upserts
recover the existing print_job_id on conflict (no nulled link); removeInventory skips
the active-check (its own retry); transfer returns success if already at destination;
Move type-ahead fills the input on select; matched scan shows only the matched bin
(+ "superseded" note if the pallet isn't active).
STAGE 2 (next): auth hardening (verified session identity). STAGE 3: serialization.
Still open from the list below: per-batch in-flight lock, idempotency-key payload
binding, listPallets 25-cap, labelPending surfaced on adjust/reprint, adjust-to-0 soft
remove.


Shipped-code fixes (do with the serialization work):
- Stable idempotency keys for adjust/move/remove/reprint (currently a fresh uuid per
  click → a timeout can double-apply). Mirror `addKeyRef`.
- `reprint`: add a `reconcile` (no-op op can stick on `pending`); validate the batch is
  active + has qty>0 + `batch.item === itemCode` before printing.
- Assert `batch.item === itemCode` + batch active before adjust/move/remove (don't trust
  the client itemCode).
- `move`: preflight the destination warehouse (group/disabled/company), like add.
- `page.tsx` pallet cache merge must let FRESH search data win (`{...p, ...seeded}`).
- `print_jobs` upsert must not reset an already-printed/claimed job back to `pending`.
- Per-batch concurrency guard: reject a new op while one is in-flight for that batch.
- `generatePalletId`: reserve the code (or owner-check a reused batch) to avoid a
  concurrent-collision merging two pallets.
- Bind the idempotency key to action/payload (reject same key + different body).
- `listPallets` 25-cap can hide older on-hand pallets; query by stock instead.
- Surface `labelPending` on adjust/reprint UI; treat adjust-to-0 as a soft remove.
- (Security, pre-existing, decide separately) `x-user-id` header is forgeable — derive
  identity from the verified session if we harden it.

Serialization build requirements (all 4 agents agree):
- Repack CANNOT increase qty. Split paths: same-qty + qty-down = Repack (consume full,
  produce target); qty-up = Repack 1:1 + Material Receipt for the delta.
- Order of operations (v15 validates batch at submission): create new batch → submit
  Repack → THEN disable old batch.
- Suffix allocation must be atomic + race-free (Supabase row lock / unique
  `(base, suffix)`); the new serial must be deterministic + reused on op retry.
- Step-indexed ops-log state (BATCH_CREATED → REPACK_SUBMITTED → OLD_DISABLED) storing
  the ERPNext Batch + Stock Entry ids; reconcile checks those ids before re-doing steps.
- Store a `superseded_by` pointer on the Batch (custom field) for old→current resolution;
  guard against cycles + cap recursion. Scanner/search must parse the `-NN` suffix.
- Partial-failure note: a repack empties the old batch to 0, so ERPNext already rejects
  the old label even if the disable step fails (disable is belt-and-suspenders).

> Rule of thumb for every change here: update this doc, keep EN+ES strings in sync,
> and remember staging must stay a superset of main so a promotion never reverts work.
