# Inventory Ops — spec & decisions (source of truth)

Living reference for the Inventory Ops module (`/inventory-ops`). Keep this in sync
whenever the label, pallet-id scheme, scanner, or actions change — Simon's standing
rule (2026-06-21): **be super consistent; never lose the label templates or these
decisions across dashboard/ERPNext updates.** Update this doc in the same commit as
any change here.

## Reservation lifecycle (HARD RULES, bug-hunt 2026-07-04)

A pallet's Stock Reservation must FOLLOW the pallet through every mutation, or the
sales order keeps phantoms / loses coverage:

| Pallet mutation | Reservation behavior | Where |
|---|---|---|
| Delete (trash) | RELEASED (+ SO staging recomputed) | remove route erp() |
| Adjust to 0 (office-only) | RELEASED — same as delete | adjust route qty-0 branch |
| Adjust to new qty | TRANSFERRED to the new serial, capped at new qty; failure → `warning: reservation_transfer_failed` | adjust route erp() |
| Reprint | TRANSFERRED to the new serial at full qty | reprint route erp() |
| Move between orders | Released from old SO + re-reserved to new (pinned relabel plan) | staging/assign route |
| Move between bins | CARRIED under the staging leases (`pallet:<family>` + `so:<name>`, same primitive as staging/assign): draft Stock Entry stamped `[op:key] [carried:so\|line\|qty\|sre]` FIRST (durable, SRE-identity-bound intent, corroborated against the named cancelled SRE before any restore) → release (pinned SRE) → submit draft (revalidated field-for-field at submit) → re-reserve in the new bin on the SAME release line. Post-commit failure → `warning: reservation_transfer_failed`; EVERY move 200 is reservation-verified in the route before responding. Reconcile is READ-ONLY; a crash mid-op wedges 'pending' like every inventory op (admin unwedges to failed_pre_erp; the born `reservation:` checkpoint — preserved across every state transition — plus the armed draft make erp()'s re-run resume the carry). Unresolved checkpoints on the EXACT batch surface a verify-only nag on later moves (never an auto-restore). Multi-pallet / partially-delivered / line-less / qty- or bin-mismatched SREs are refused in preflight. Bulk transfer SKIPS reserved pallets (reason `reserved`). Superseded stamped DRAFTS are DEFUSED (tags voided) only after their fate is decided — never while they are the sole recovery artifact. | move route (leases + post-op verify); `reservedMoveGuard` / `verifyOrRestoreMovedReservation` in inventory.ts |
| Ship (DN submit) | Consumed natively via so_detail linkage | ERPNext |
| Undo shipment | Restored natively (DN cancel) + staging recomputed in stock UoM | fulfillment.ts |

Other invariants from the same hunt:
- **Physical vs available qty**: `get_batch_qty` SUBTRACTS reservations whenever
  `item_code` is passed. Dashboard lookups always pass `ignore_reserved_stock: '1'`
  (string!). Reservations render as their own badge, never baked into qty.
- **Complete Shipment is per-SO mutually exclusive** via an ops-log advisory row
  (`family = SHIP-<so>`, existing partial unique index). Loser gets 409.
- **Staging allocation is delivered-aware**: line remaining = ordered −
  max(reserved, delivered), so manually-shipped lines can't take new pallets.
- **Case**: pallet ids canonicalize to UPPERCASE at every comparison boundary
  (search resolvers, ship-screen scan set, server complete).
- **OPEN policy question (Simon)**: partial-pallet reservations (319 of a 352
  pallet) ship only the reserved qty while the physical pallet leaves whole.

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
- **SnapPad brand logo (SHIPPED 2026-07-03, Simon-approved)**: labels for any item in the
  ERPNext item group **Snap Pad** (current and future products automatically) print the SnapPad
  logo above the QR. QR stays at its EXACT standard size; to make room the QR shifts toward the
  reading bottom and the timestamp/printed-by lines move to the bottom of the left text column.
  All other item groups are pixel-identical to before (the 2026-06-21 no-company-branding rule
  still applies — this is the product's own brand). Logo bitmap: `lib/erpnext/snappad-logo.ts`
  (^GFA, 180 reading-dots tall, rotated 90° CW for the landscape template, generated with PIL
  from snappad-portal/public/logo.png; verified via Labelary render). Selection:
  `brandForItemGroup()` in label.ts, fed by Item.item_group in the add / reprint / move-relabel
  paths (serialized and generic labels both).
- **Weight + Dimensions (SHIPPED 2026-07-03)**: optional inputs on the Add form
  (`Weight (lb)` number + `Dimensions (LxWxH in)` text). Stored on the Batch as
  `custom_pallet_weight` (Float) + `custom_pallet_dims` (Data) — ERPNext has no
  native per-batch weight/dims (script: erp-4molding
  `scripts/erpnext-custom-2026-07-03/12_pallet_weight_dims.py`). Printed on the
  label via the existing optional Weight/Dimensions rows (`{n} lb` / raw dims
  string); a reprint/reissue CARRIES THEM OVER to the new serial and prints them.
  Shown under the pallet row in inventory-ops (grey `850 lb · 48x40x60 in` line).

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
- `adjust` — change a pallet qty. A non-zero change REISSUES the pallet as the next
  serial at the new qty (see Serialization) + prints the new label; equal-qty is a no-op;
  qty 0 is a soft remove. Pins the target qty to the first logged intent on retry.
- `remove` — issue-out + disable batch (office roles); cancel-not-delete.
- `move` — Material Transfer of a pallet to another bin; logged as `move` (shows in
  history). No label reprint (location isn't on the label).
- `bulk-transfer` — move MANY pallets to one destination bin in a single atomic ERPNext
  Material Transfer (multi-row Stock Entry). Logged as `bulk-transfer`. Companion GETs:
  `pallet-lookup` (resolve a scanned/typed id → current serial, item, current bin, qty;
  used to validate before queueing) and `last-transfer` (most recent bulk-transfer row →
  dest + count + who + when). See "Bulk bin transfer" below.
- `remove` reason is **optional** — the delete prompt still appears, but OK with a blank
  reason proceeds (faster); only Cancel aborts. (`submitRemove` aborts only when
  `prompt()` returns `null`; the `/remove` route treats `reason` as optional.)
- `reprint` — REISSUES the pallet as the next serial (old label voided) and prints it;
  logged as `reprint` (shows in history); idempotent per key. See Serialization.
- `pallets` — list on-hand pallets for an item.
- `history` — **traceability**: per-pallet timeline from `inventory_ops_log` (every
  op stamps `created_by` + `created_at`); UI derives qty/bin transitions from order.

## Traceability / user attribution
- `inventory_ops_log` (Supabase) records every action with `created_by`, `created_at`,
  `action`, `qty`, `warehouse`, `batch`, `status`. This is the audit source.

## Serialization (Stage 3 — SHIPPED) — `lib/erpnext/inventory.ts`
To stop two physical labels from sharing a code, a reprint OR a qty change REISSUES the
pallet as the next serial in its family (`D79C` → `D79C-02` → `D79C-03`) and disables the
old batch. ERPNext then rejects the old/empty/disabled batch natively everywhere (incl.
scan-to-ship), so a stale label can't be used.
- **`reissuePallet`** (the only mutator): recomputes from the LIVE on-hand of both batches
  each call, so it's resumable after any partial failure. It moves old→new 1:1 (Repack),
  issues out qty-down excess, receipts a qty-up shortfall, trims any over-target excess on
  the new batch, then asserts its postcondition (new holds exactly target AND old drained)
  before reporting success. THROWS (no ghost-success) if no bin holds stock.
- **`verifyReissue`** (READ-ONLY): runInventoryOp's `reconcile()`. Reports done only if the
  reissue already completed; never mutates. So a duplicate/retry on the `pending` path
  can't run a second reissue alongside the in-flight one — only `erp()` mutates, re-run
  under the state machine's compare-and-swap claim.
- **Concurrency:** a partial unique index `inventory_ops_active_family_uniq` on
  `inventory_ops_log(family) WHERE status IN ('pending','erp_committed','failed_pre_erp')`
  gives ATOMIC one-active-op-per-pallet-FAMILY exclusion across the whole reissue (the
  read-then-insert pre-check is just friendly UX). `family = palletBase(batch)`, set by
  every mutating route. The lock is intentionally HELD through `failed_pre_erp` so a
  half-finished reissue can't be stepped on — it stays locked until the same-key retry
  drives it to `done`. **Escape hatch:** a permanently-failed op (e.g. a split-bin pallet,
  or a lasting ERP fault) keeps its family locked; an admin clears it by setting that
  `inventory_ops_log` row's `status` to `done` (if ERP state is actually correct) or
  `cancelled` after reconciling stock in ERPNext. A future admin UI button can wrap this.
  Since 2026-07-08 the 409 message names the holder (action + stored error) when the
  blocker is a `failed_pre_erp` row, so the floor doesn't read a dead lock as "in
  progress" (Abel / 5TJQ incident; that row was cleared via this escape hatch).
- **Scanned-code parsing:** `lib/pallet-code.ts` (`extractPalletCode`, unit-tested in
  `lib/pallet-code.test.ts` — `node --test lib/pallet-code.test.ts`) is the ONLY place a
  raw scan/QR payload becomes a pallet id. Every scanner section — camera (`PalletScanner`)
  or future hardware-wedge inputs — must call it; a private regex is how the 2026-07-08
  truncated-reprint-suffix bug happened (33R5-02 scanned as the retired 33R5).
- **Reserved pallets:** reprint RELEASES the pallet's SO reservation BEFORE the reissue
  and re-reserves the new serial after (best-effort) — ERPNext v15 refuses to move
  reserved stock (NegativeStockError), which is exactly how the 5TJQ reprint died.
  Remove has always released before issuing out. A failed re-reserve surfaces as the
  order needing re-staging, never as phantom stock.
- **Serial reservation:** `reserveNextSerial` creates the next Batch atomically (the unique
  Batch name is the lock); persisted to `result_batch` so a retry reuses it.
- **`resolveCurrentSerial`:** maps any scanned serial to the current one = highest active
  serial THAT HOLDS STOCK (falls back to highest active only if none do), so a reserved-
  but-empty serial never strands a scan. `locate` returns `superseded` when the scanned
  label isn't current; the UI shows a banner and follows the live serial.
- **History** chains the whole family (base + `base-NN`); batch codes are whitelisted to
  `[0-9A-Z]` before the PostgREST `.or()` filter.

## Locations view + Reports (SHIPPED 2026-06-22) — `lib/erpnext/inventory.ts`, page.tsx
- **Locations view:** the inventory-ops page has a **By item / By bin** toggle. "By bin" is a
  bin COMBO BOX (type to filter or open the full dropdown) -> select -> live bin contents
  (each item + qty + the pallet ids in that bin) via `GET /bin-contents?warehouse=`.
- **`enumeratePallets(itemCodes)`** is the shared pallet engine: lists active batches for the
  codes (no page cap) then `get_batch_qty` per batch at BOUNDED concurrency (`mapLimit`, 10),
  emitting one row per (batch, warehouse) with the correct PER-WAREHOUSE qty (fixes split-
  batch mis-attribution). `listPallets`, `getBinContents`, `getFullInventory` all use it. A
  per-batch failure RETRIES once then THROWS (route → 502) — a report never silently omits
  pallets (audit integrity).
- **Reports (3 scopes):** one **bin** (CSV+PDF, from Locations), one **product** (CSV+PDF,
  buttons on each search card; gated until pallets load with no error), and the **full
  inventory** as an `.xlsx` workbook (exceljs) — two AutoFilter tabs **By Bin** + **By
  Product**, each with a Pallets column; from `GET /report` (`maxDuration=300`, includes
  pallet ids facility-wide, bounded concurrency = thorough but slow on big sites). CSV cells
  pass through a formula-injection guard. All report labels/headers/tab names are EN+ES via `t()`.
- **Lazy pallet load:** the page seeds pallet ids for locate's top items; beyond that it
  auto-loads only the top `LAZY_PALLET_LIMIT` (24) results (ref-deduped) to bound fan-out.
  After any write the handlers call BOTH `refreshSearch()` (bins/totals) and
  `loadPallets(itemCode)` (rows) so cached items don't go stale.
- Known tradeoff: a very large full-inventory export is slow + holds all rows in browser
  memory (exceljs) — acceptable for now; optimize (server-stream) if it bites.

## Bulk bin transfer (SHIPPED 2026-06-22) — `lib/erpnext/inventory.ts:bulkTransfer`, page.tsx
A third **Transfer** view toggle (next to By item / By bin). Workflow: pick the destination
bin ONCE (shared `BinCombobox`), then scan or type pallet IDs into a queue, then **Post
Transfer** moves the whole queue at once. Shows the last transfer (dest + count + who + when).
- **Queue building:** each scan/type does `GET /pallet-lookup?code=` → resolves the current
  serial (a superseded id maps to its live one), item, current bin, qty. The queue only holds
  valid, in-stock, not-already-at-destination pallets (dedup by batch). The Transfer view
  mounts a continuous `PalletScanner` (2.5s same-code cooldown via `lastScanRef`); the text
  input adds on Enter. Rows show a remove-X.
- **Post = ONE atomic Stock Entry:** `bulkTransfer({destination, lines, opKey})` dedupes by
  batch, preflights the item/dest, resolves each pallet's source bin/qty (`getBatchLocation`,
  skipping no-stock / split / already-at-dest → returned as `skipped`), and builds a single
  `Material Transfer` Stock Entry with one row per pallet (`use_serial_batch_fields:1` +
  `batch_no`, per-row source warehouse, t_warehouse = destination). All-or-nothing: ERPNext
  submits it atomically. Returns `{ moved, skipped, destination }`.
- **Idempotency:** `runInventoryOp` with `action:'bulk-transfer'`, `family:null` (a bulk move
  spans many pallets so it can't take the per-pallet family lock; a move never reissues
  serials so that lock isn't needed — worst case a concurrent reissue/remove on a queued
  pallet makes this Stock Entry fail at submit, a clean re-postable failure, never a silent
  double-move). Retry reconciles by finding the `[op:key]`-stamped Stock Entry, not re-posting.
- **Identity binding:** `meta.item_code` = JSON-encoded sorted unique batch set (delimiter-safe
  fingerprint), so reusing a key with a different pallet set is rejected, not run on the wrong
  batches.
- **GOTCHA (4-agent review):** do NOT overwrite `inventory_ops_log.qty` with the actual moved
  count — `qty` is part of `runInventoryOp`'s identity check, so a lost-response retry of a
  *partial* transfer (moved < queued) would falsely 409 as a "different operation". `qty` stays
  = the queued count; skips are near-zero anyway since the queue is pre-validated at scan time.
  The fresh-post response still returns exact `moved`/`skipped` to the UI.
- Endpoints: `POST /bulk-transfer` (MAX_LINES=200, `maxDuration=120`), `GET /pallet-lookup`,
  `GET /last-transfer`. All UI strings bilingual (EN+ES).

## Non-serialized (quantity) items (SHIPPED 2026-06-22) — `lib/erpnext/inventory.ts`, page.tsx
Some product lines are fixed, interchangeable packs (CURB-36PK / EB-48PK families — 20 SKUs)
that we do NOT serialize: every box is identical, so a unique pallet code carries no useful
information. In ERPNext these items have `has_batch_no=0`; stock is a plain quantity per bin.
- **Unit = box.** 1 ERPNext stock unit = 1 box/pack. You receive / move / remove BOXES. The
  pack size (pieces per box, e.g. 36/48) is parsed from the SKU's `NNPK` token (`packSize()`)
  and printed on the label as info only.
- **Branch point:** an item's `has_batch_no` flag (read live via `getItemInfo`, surfaced as
  `hasBatch` on locate results) decides serialized-pallet vs quantity handling everywhere.
- **Receive:** the Add panel works for both; the `add` route branches on `has_batch_no`. A
  non-batch receive posts a Material Receipt (no batch) and prints a GENERIC label — part # +
  pack size + a QR encoding the PART NUMBER (no unique pallet code) — one copy per box via ZPL
  `^PQ` (capped 9999, which also caps the receive qty so stock can never exceed labels). qty
  must be a whole number.
- **Transfer / remove:** the By-item card renders quantity-mode controls (per-bin "Move N
  boxes" → another bin, "Remove N boxes" for damage/internal use) instead of pallet rows.
  Routes `qty-transfer`, `qty-remove` (Material Transfer / Material Issue, no batch). Both go
  through `runInventoryOp` with `family=null` (no per-pallet lock needed; quantity moves are
  additive and dedup via the client key + `[op:key]` reconcile). `qty-remove` is office-only.
  Order-based shipping/fulfillment stays in ERPNext, per the dashboard-vs-ERPNext boundary.
- **Converting an item to non-batch:** set `has_batch_no=0` on the Item. Clean ONLY when the
  item has 0 stock and 0 Stock Ledger Entries (ERPNext blocks the toggle otherwise). The 20
  SKUs were converted via bench (`~/frappe-bench/env/bin/python`, run from
  `~/frappe-bench/sites`, site `erp.local`) — pattern in `/tmp/convert_nonbatch.py`. The
  dashboard service token CANNOT edit Item masters (403), so this needs admin/bench.

## Deleted-pallet scan + restore (SHIPPED 2026-06-22) — `lib/erpnext/inventory.ts`, page.tsx
- **Scan a removed pallet:** when a scanned pallet's family has no active serial holding stock
  (it was removed/zeroed), `lookupRemovedPallet` returns its data (part, last label qty = the
  batch's `custom_pallet_qty`, last bin from the Stock Ledger Entry) and the locate route
  surfaces it as `removedPallet`. The UI shows a card at 0 with its history instead of the
  pallet vanishing.
- **Restore:** scan → "Return to inventory" (office-only). Returning the SAME qty as the label
  re-enables the SAME serial and re-receipts it — the printed label is still valid, no new
  label. A DIFFERENT qty reissues a NEW serial + new label (the UI confirms first; the old
  serial stays disabled). `restorePallet` asserts the pallet currently holds 0 on-hand before
  re-receipting (gated on a fresh op via `reconcileStockEntry`, so retries stay idempotent).
  Route `/restore`; same-vs-different decided from the authoritative `custom_pallet_qty`, the
  reissue serial reserved + pinned in `result_batch` like reprint.

## Recently deleted labels panel (SHIPPED 2026-06-26 to staging) — `recent-deletions/route.ts`, page.tsx
A log panel under "Recently printed labels", same shape: the most recent serialized pallet
deletions (last 10, expand to 50). Each row shows the pallet id, label quantity, last bin,
who deleted it, and when. Per row: **History** (read-only, available even after the deletion
is undone) and, for office roles, an inline **Edit / return to inventory** form — qty +
destination bin, prefilled to the label qty + last bin. Reuses the `/restore` route: same qty
reuses the printed label, a different qty reprints a new one (confirm first). A deletion
already undone (a later successful `restore` op on the same pallet `family`, newest restore
timestamp > this remove's) shows a **Restored** badge with no restore button.
- **Data:** `GET /api/erpnext/inventory/recent-deletions` reads `inventory_ops_log` rows with
  `action='remove' status='done'`, enriches label qty + last bin via `deletedPalletMeta`
  (both survive removal: the Batch is disabled not deleted; the Stock Ledger keeps the bin),
  item names via `itemNameMap`. All enrichment is best-effort (`.catch` → null) so a failed
  ERPNext call degrades a field, never breaks the panel. Read-only + `requireInventoryAccess`.
- **Double-restore guard (authoritative, server-side):** `/restore` calls `familyHasLiveStock`
  on the first attempt and rejects (409) if ANY serial in the pallet family already holds
  stock — closes the stale-panel / fail-open-status / different-qty-reissue (old serial at 0,
  new serial holds stock) double-count hole. Does NOT trust the read-model `restored` flag.
  Hardens the scan-restore path too. 4-agent reviewed (Opus/Codex/Gemini/Grok all APPROVE).
- **Scope:** serialized PALLET deletions only — that's where the reuse-or-reprint-label
  semantics live. Non-serialized box removals (`qty-remove`) are a bulk quantity, not a single
  label; re-add them through the normal receive flow.

## Delete + reprint confirmation dialog (SHIPPED 2026-06-26 to staging) — page.tsx
A misclick on the trash (delete) or reprint icon is costly — delete pulls stock, reprint voids
the current label and reissues a new pallet code. Both now route through a promise-based
confirmation modal (`askConfirm` → `confirmReq` state) with **Confirm / Cancel** before anything
fires. The two delete paths (`submitRemove` pallet, `submitQtyRemove` boxes) fold the optional
removal reason into the modal, **replacing the old `window.prompt`** (blank reason still removes;
only Cancel aborts — behavior preserved). The reprint dialog (`submitReprint`) has no reason box.
- **Re-entrancy:** a `confirmReqRef` mirrors the state so `resolveConfirm` clears it synchronously
  (no double-resolve race) and a second `askConfirm` abandons any in-flight request `{ok:false}`
  (rapid double-click can't orphan the first promise).
- **Keyboard:** Escape cancels; Enter confirms (reason input owns Enter on the delete path, the
  reprint dialog autofocuses + Enter-confirms its button). `aria-labelledby/describedby` wired.
- Red confirm button for delete, amber for reprint. Bilingual: `inventoryOps.confirm{Delete,Reprint}{Title,Msg,Btn}`.
- 4-agent reviewed (Opus/Codex/Gemini/Grok); the re-entrancy + keyboard fixes came from that pass.

## Mobile nav (SHIPPED 2026-06-22) — `components/layout/Sidebar.tsx`
The iPhone drawer was a flat everything-list. Now all sections are wrapped in the same
`CollapsibleNavSection` + `NavAccordionProvider` as desktop (one section open at a time,
the current page's section auto-opens). storageKeys match `navSections`/`activeSectionKey`.

## Open / pending (in build order)
1. **Attach to Sales Order** at add time (searchable SO field; prints on the label).
2. **Weight + Dimensions** capture at print (optional; under the pallet id on label).
3. **Audit feature** (FUTURE) — structured inventory audit/verification flow built on
   the bin/full reports; tracked as a pending item to design later.

Done: search/locate, add, adjust, remove, list pallets, history (traceability),
**bin Move**, **Reprint**, generated date/time on label, scanner zoom + reticle,
**Stage 3 serialization** (reissue-on-reprint/qty-change), **inline pallet actions**
(no expander), **Locations view** (browse by bin), **bin/product/full reports**
(CSV/PDF + full .xlsx), **mobile collapsible nav**.

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
STAGE 2 DONE (auth hardening): requireInventoryAccess verifies the Supabase JWT
(Authorization: Bearer) via getUser() and derives identity from it; routes attribute
to guard.userId; authedFetch sends the token + retries once on 401 (refresh); devices
stay read-only. 4-agent reviewed — no bypass; fixed token-timing 401 retry, scanned-
pallet qty always attached, safe header order, case-insensitive Bearer. Noted future
perf: verify JWT locally (jose + SUPABASE_JWT_SECRET) instead of getUser per request.
STAGE 3 (next): serialization. Then: Locations view + bin PDF/CSV report; audit (future).
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
