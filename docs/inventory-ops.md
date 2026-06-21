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
- **Generated date/time** prints in the scan zone (replaced the old "SCAN PALLET"
  caption). Stamped server-side at print time by the route.
- TODO (later, agreed): Weight + Dimensions under the pallet id.

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
- `locate` — search by part number/name OR pallet code → item card + bins.
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
1. **Attach to Sales Order** at add time (searchable SO field; prints on the label).
2. **Weight + Dimensions** capture at print (optional; under the pallet id on label).
3. **Locations view** — toggle to search a bin and list its contents.

Done: search/locate, add, adjust, remove, list pallets, history (traceability),
**bin Move**, **Reprint**, generated date/time on label, scanner zoom + reticle.

> Rule of thumb for every change here: update this doc, keep EN+ES strings in sync,
> and remember staging must stay a superset of main so a promotion never reverts work.
