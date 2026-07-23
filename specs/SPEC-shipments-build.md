# SPEC — Shipments section (executor handoff)

Executor: codex gpt-5.6-sol. Director: claude-3. Parent plan: `specs/shipments-analytics.md`
(read it first for intent; THIS file is the binding implementation contract).

**RULES (non-negotiable):**
- Work ONLY inside this worktree (`~/clawd/worktrees/shipments-analytics`). Read files from
  HERE, never from any other checkout.
- **Do NOT run `git commit` or `git add`** (worktree index is outside your sandbox; the
  director commits). Just write files.
- **STOP-on-discrepancy:** if anything you find in the codebase contradicts this spec
  (missing helper, different signature, conflicting pattern), STOP that item and record the
  discrepancy in `DONE.md` instead of improvising around it.
- Every user-facing string goes through `t('key')` with the key added to BOTH
  `locales/en.json` AND `locales/es.json` in the same edit. No hardcoded English in JSX.
- When finished with your assigned phase, write `DONE-<phase>.md` at repo root: what you
  built, deviations/discrepancies, anything intentionally left for the director.

## Verified facts (do not re-derive; trust these)

- Table `public.shipment_history` (project mqfjmzqeccufqhisqpij), 247 rows today. Columns:
  `id, run_id, sent_at timestamptz, po_number, partner, ship_to_name, ship_to_address,
  city, state, zip, residential bool, service, source_system, tracking, part_number,
  qty int, email, phone`. Unique key `(run_id, po_number, part_number)`.
  - `service` values today: `FedEx Ground`, `FedEx Home Delivery`, `LTL (set-aside)`.
    LTL rows have NO tracking — that is CORRECT data, never render it as an error.
  - `source_system` today: `SPS EDI (Home Depot)`; `SPS-Amazon` arrives 2026-07-24; more
    later. Treat as open enum — never hardcode the list, always derive facets from data.
  - **email/phone are PII — never select them, never render them (v1).**
- Storage bucket `shipment-deliverables` (private, currently EMPTY — first upload tonight).
  Files land at `<YYYY-MM-DD>/<name>-<YYYYMMDD>.pdf` where name ∈
  `packing-slips-fedex | packing-slips-LTL | labels-print | run-summary`.
  Pages must handle empty days gracefully (normal state, not an error).
- Print relay: table `print_jobs` (`station_id, format ('zpl' default|'pdf'), zpl (payload;
  base64 for pdf), item_code, batch, created_by, idempotency_key, status, error,
  claimed_at, printed_at`), table `print_stations` (`id, name, letter_printer, enabled`).
  Stations today: production/snappad/packaging (letter_printer NULL), **shipping**
  (letter_printer 'canon-shipping'). Station agents print `format='pdf'` jobs to the
  station's LETTER printer only — **PDF-to-Zebra is NOT supported by the deployed agents**;
  the claim RPC has no format filter, so a zebra-targeted pdf job would misprint on
  letter. Therefore v1 relay-dispatches ONLY letter files (see S5).
- supabase-js returns numerics as strings sometimes and silently caps un-ranged selects at
  1000 rows — server aggregates via RPC; any raw row read uses the `.range()` loop with a
  stable `.order()` (copy the loop shape from
  `app/api/erpnext/inventory/report/route.ts:16-35`).

## Patterns to copy (exact files)

- Server auth: `requirePermission(req, key)` from `lib/require-user.ts` (usage example
  `app/api/orders/assign/route.ts:26`). Client fetches attach `authHeaders()` from
  `lib/session-token.ts`.
- Service client: `supabaseAdmin` from `lib/supabase-admin.ts`. Route boilerplate:
  `export const dynamic = 'force-dynamic'`, `runtime = 'nodejs'`, `maxDuration` as needed.
- ET date helpers: copy semantics of `todayInEasternTime()` / `isRealDate()` from
  `app/api/erpnext/inventory/report/route.ts:154-170` into `lib/shipments/et-date.ts`
  (shared by routes) — do NOT import from the report route.
- Signed URLs: `supabaseAdmin.storage.from(bucket).createSignedUrl(path, ttl)` pattern from
  `app/api/quality/models3d/route.ts:33-38`.
- Print enqueue: mirror `app/api/erpnext/fulfillment/print-document/route.ts` (GET stations
  + POST job with base64 pdf payload, 10 MB cap, copies 1–5, `userCanPrintTo` from
  `lib/erpnext/printer-access.ts`).
- Page skeleton/stats/table/cards: `app/(dashboard)/shipped/page.tsx` is the canonical
  model (Suspense wrapper, SpotlightCard + ScrollReveal + useCountUp stats,
  useDataTable/DataTable with renderCard for phones).
- Charts: recharts (installed), style per `components/sales/TopCustomersBarChart.tsx`
  (ResponsiveContainer in fixed-height div, theme tokens `hsl(var(--border))` etc.).
- Server xlsx: `exceljs` (installed; used client-side today — import normally in a
  nodejs-runtime route). Server PDF: `@react-pdf/renderer` per
  `app/api/quotes/generate/route.ts` (renderToBuffer).
- Permission registration: add keys to `ALL_MENU_PATHS` + `PATH_LABELS` (+
  `PATH_DESCRIPTIONS`) in `app/(dashboard)/admin/permissions/page.tsx:19-100`.
- Nav: `components/layout/Sidebar.tsx` — add a NavItem[] array + a CollapsibleNavSection in
  BOTH the desktop aside (~line 396-670) AND the mobile aside (~674-957; it inlines its own
  Link markup — follow its existing style), plus the `navSections` array (~293) and
  `baseCommandPaletteItems` in `app/(dashboard)/layout.tsx:47`. Filter items with
  `canAccess` exactly like `filteredProduction` (Sidebar.tsx:270).

## Permission model

- Page key **`/shipments`** gates the whole section (AccessGuard + sub-path walk covers
  `/shipments/*`; nav filter uses it).
- Verb key **`shipments:print`** gates relay dispatch (client `canAccessExact`, server
  `requirePermission`).
- Register BOTH in the admin permissions page arrays. All new API routes:
  reads → `requirePermission(req, '/shipments')`; print dispatch →
  `requirePermission(req, 'shipments:print')`. 401/403 JSON shapes as in existing routes.

## Phase A (backend): migration + lib + API routes

**A1. `supabase/migrations/20260723_shipments_analytics.sql`** (idempotent; the director
applies it manually — also list it in DONE):
```sql
CREATE INDEX IF NOT EXISTS shipment_history_sent_at_idx ON public.shipment_history (sent_at);
CREATE INDEX IF NOT EXISTS shipment_history_part_idx ON public.shipment_history (part_number);
CREATE INDEX IF NOT EXISTS shipment_history_source_idx ON public.shipment_history (source_system);

CREATE OR REPLACE FUNCTION public.shipment_daily_rollup(p_from date, p_to date)
RETURNS TABLE(day date, source_system text, part_number text, service text,
              units bigint, lines bigint, orders bigint)
LANGUAGE sql STABLE AS $$
  SELECT (sent_at AT TIME ZONE 'America/New_York')::date AS day,
         source_system, part_number, service,
         SUM(qty)::bigint, COUNT(*)::bigint, COUNT(DISTINCT po_number)::bigint
  FROM public.shipment_history
  WHERE (sent_at AT TIME ZONE 'America/New_York')::date BETWEEN p_from AND p_to
  GROUP BY 1, 2, 3, 4
$$;
REVOKE EXECUTE ON FUNCTION public.shipment_daily_rollup(date, date) FROM PUBLIC, anon, authenticated;
```
(Grant stays implicit for service_role/owner — same posture as `intraday_snapshot_times`.)

**A2. `lib/shipments/` module:**
- `types.ts` — ShipmentRow (WITHOUT email/phone), DailyRollupRow, VolumeBucket,
  DeliverableFile, facet types.
- `et-date.ts` — `todayET(): string`, `isRealDate(s)`, `etRangeToDates(from,to)` guards.
- `rollup.ts` — pure functions: `bucketize(daily: DailyRollupRow[], bucket:
  'day'|'week'|'month'|'quarter'|'year')` (week = ISO Monday; quarter = calendar Q),
  `topPartsWithOther(rows, n=8)` (returns per-bucket stacks keyed by top-N part_numbers +
  'Other'), `summarize(daily)` (today/thisWeek totals, by source, LTL lines). All numeric
  fields pass through `Number()` defensively.
- `rollup.test.ts` — node:test cases for week/quarter/year edges (year boundary week, Q
  boundaries, Other-bucket sums preserved, empty input). Import style must match
  `lib/component-availability.test.ts` (runs under `npx tsx --test`).

**A3. Routes (all under `app/api/shipments/`):**
- `summary/route.ts` GET → `{ today, thisWeek, bySource, ltl, latestDay }` computed from
  `supabaseAdmin.rpc('shipment_daily_rollup', {p_from: <today-27d>, p_to: today})` +
  `summarize`. ET week = Mon–Sun containing today.
- `volume/route.ts` GET `?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|week|month|quarter|year`
  → validated (isRealDate, from<=to, span ≤ 1100 days, bucket whitelist) → rpc daily
  rollup → `bucketize` + `topPartsWithOther` → `{ buckets, parts, totals }`. No caching
  headers (`Cache-Control: no-store`).
- `explorer/route.ts` GET with query params `q` (address search), `part`, `from`, `to`,
  `source`, `service`, `residential` (`true|false`), `ltl` (`1`), `page` (0-based),
  `pageSize` (25|50|100, default 50). Build ONE supabaseAdmin query:
  `.select('id,run_id,sent_at,po_number,partner,ship_to_name,ship_to_address,city,state,zip,residential,service,source_system,tracking,part_number,qty', { count: 'exact' })`,
  `q` → `.or()` of `ilike` across ship_to_name/ship_to_address/city/state/zip (escape `%`
  and `,` in user input; PostgREST or() syntax), `part` → ilike part_number,
  from/to → ET day bounds on sent_at, ltl=1 → `service.eq.LTL (set-aside)`,
  `.order('sent_at', {ascending:false}).order('id', {ascending:false})`,
  `.range(page*pageSize, page*pageSize+pageSize-1)`. Return `{ rows, count, facets }`
  where facets = distinct source_system + service values (separate small selects with
  head-style grouping via rpc rollup over the filtered date span is NOT needed — derive
  facets from an unfiltered-but-date-bounded select of just those two columns using the
  range loop, cap 5000, dedupe in JS).
- `export/route.ts` GET — same filter params + `format=xlsx|pdf`. Fetch ALL matching rows
  server-side via the `.range()` loop (stable order sent_at desc, id desc), caps:
  xlsx 50_000 rows, pdf 2_000 rows — when over cap, truncate AND include a visible first
  row/banner "Truncated to N rows — narrow your filters" (EN in the file; UI also warns).
  xlsx: exceljs workbook, one sheet "Shipments", bold header, columns = the explorer
  columns, dates rendered in ET. pdf: @react-pdf/renderer, landscape LETTER, repeating
  header, small font, footer page numbers. Response: `new NextResponse(buffer)` with
  Content-Type + `Content-Disposition: attachment; filename="shipments-<from>-<to>.<ext>"`
  + `Cache-Control: no-store`. `maxDuration = 300`.
- `deliverables/route.ts` GET `?date=YYYY-MM-DD` (default todayET) → storage list prefix
  `${date}/` → `{ date, files: [{name, path, size, kind}] }` where kind ∈
  `packing-fedex|packing-ltl|labels|summary|other` derived from filename prefix. Empty
  list is a 200 with `files: []`.
- `deliverables/sign/route.ts` POST `{ path }` — validate
  `^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\.pdf$`, createSignedUrl(path, 120), return
  `{ url }`. NEVER cache; NEVER called at render time from server components.
- `print/stations/route.ts` GET → enabled stations with non-null letter_printer filtered
  by `userCanPrintTo` (mirror print-document GET, but permission `shipments:print`).
- `print/route.ts` POST `{ date, path, station, copies }` — permission `shipments:print`;
  validate path (same regex + must start with `${date}/`); **letter files only**: basename
  must start with `packing-slips-fedex-|packing-slips-LTL-|run-summary-` — anything else
  (incl. `labels-print-`) → 422 `{ error: 'zebra_unsupported' }`. Download from bucket via
  supabaseAdmin, cap 10 MB (413 over), base64, insert `copies` (1–5, default 1) rows into
  `print_jobs`: `{ station_id, format:'pdf', zpl: b64, item_code:'SHIPMENT-DOC',
  batch: date, created_by: <user id from guard>, idempotency_key:
  'shipdlv-<path>-<Date.now()>-<i>', status:'pending' }`. Station must exist, be enabled,
  have letter_printer, and pass `userCanPrintTo`. Return `{ queued: copies }`.
- `print/status/route.ts` GET `?date=` → last 20 `print_jobs` rows where
  `item_code='SHIPMENT-DOC' and batch=date`, select
  `id,station_id,status,error,created_at,printed_at` ordered desc → for the S4 status list.

Note for the guard in print routes: `requirePermission` returns boolean only — ALSO call
`requireUser(req)` to get the user id for `created_by`; if null → 401.

## Phase B (frontend): nav, permissions UI, pages

**B1. Registration:** admin permissions page arrays (`/shipments`, `shipments:print` with
labels "Shipments" / "Shipments — send to printer" + Spanish-agnostic description strings
as those arrays are EN-only today — follow existing style), Sidebar (new section between
SHIPPING and SALES: items Overview `/shipments`, Analytics `/shipments/analytics` sub,
Explorer `/shipments/explorer` sub, Print files `/shipments/print` sub; lucide icons e.g.
`PackageCheck`, `BarChart3`, `Search`, `Printer`), BOTH asides + navSections +
command palette. i18n keys `nav.shipments*` in both locales.

**B2. `/shipments` (S1 Overview).** Stats cards: Today (units + orders), This week (units +
orders), per-source chips (derived, not hardcoded), LTL lines today/this week. A compact
14-day recharts bar (units/day, single color) as a teaser linking to Analytics. "Today's
print files" card listing today's deliverables (from `deliverables` route) linking to
`/shipments/print`. All data via the summary + volume routes with `authHeaders()`.

**B3. `/shipments/analytics` (S2).** Controls: bucket toggle (Day/Week/Month/Quarter/Year),
range presets (This month, Last 30d, Last 90d, YTD, All) + custom from/to date inputs
(native `<input type="date">`, max = todayET). Chart: recharts stacked BarChart — one Bar
per part in `parts` (top-8 + Other), stackId shared, legend, tooltip with per-part +
total. Below: totals table (bucket × units/orders/lines, plus per-source split row
expandable or a second small table — keep simple: one table bucket|units|orders|lines).
Empty state message. Mobile: chart height ~300, horizontally scrollable table.

**B4. `/shipments/explorer` (S3).** Search input (debounced 300ms) hitting `q`; facet
selects for source_system + service (options from `facets`), residential toggle
(All/Residential/Commercial), LTL-only chip, date range inputs. Server-driven pagination
(Prev/Next + "N of count") — do NOT use useDataTable (it's client-data; this table is
server-paged): build a lean table component in the page following DataTable's styling
classes, with a phone card layout (`sm:hidden` cards / `hidden sm:table` table) matching
OrderCard visual style. Columns: sent_at (ET, `MM/dd HH:mm`), po_number, partner,
part_number, qty, ship_to_name, city+state+zip, service (LTL rows get an amber "LTL"
badge and NO tracking link), residential icon, source_system, tracking → carrier link
(FedEx: `https://www.fedex.com/fedextrack/?trknbr=<n>`; unknown/blank → plain text/dash).
Export buttons "Excel" / "PDF" → open `/api/shipments/export?...current filters...`
via a fetch-to-blob download WITH authHeaders (routes are auth-gated; a plain <a href>
won't carry the JWT). Disable buttons while generating; toast on failure; show the
truncation warning when count exceeds the cap for the chosen format.

**B5. `/shipments/print` (S4+S5 v1).** Date picker (default todayET, max today). Fetch
deliverables; render the four known kinds with friendly names + any `other` files:
- Every file: **View** button → POST sign route → `window.open(url)` (signed URL fetched
  ON CLick, never pre-rendered).
- Letter files (packing-fedex, packing-ltl, summary): **Send to printer** (visible only if
  `canAccessExact('shipments:print')`) → station dropdown (from print/stations; if exactly
  one station, preselect it — today that's "Shipping"), copies stepper 1–5 default 1,
  confirm → POST print → toast queued.
- Label file (labels): a muted note (bilingual) "4×6 label PDFs print via View for now —
  direct Zebra dispatch is coming" — NO relay button (server enforces the same).
- Status strip below: poll print/status?date every 10s while page visible; rows
  station/status/time with error text if any.
- Empty state: "No files for this date yet — the overnight run uploads them" (bilingual).

## Acceptance checks (director runs these; make them pass)

1. `npm run typecheck` — no NEW errors (pre-existing: pallet-code.test/sales-math.test
   TS5097, push-notifications/register-sw pushManager, component-availability.test TS5097).
2. `npx eslint` on all new/changed files — no errors (warnings existing-style only).
3. `npx tsx --test lib/shipments/rollup.test.ts` — green.
4. `npm run build` — compiles.
5. grep: no `email`/`phone` selected or rendered anywhere under shipments code.
6. grep: every new `t('...')` key exists in BOTH locales/en.json and locales/es.json.
7. No signed URL ever appears in a server component / ISR path (client fetch on click only).
8. Explorer queries always `.order().range()`; no un-ranged reads of shipment_history.
