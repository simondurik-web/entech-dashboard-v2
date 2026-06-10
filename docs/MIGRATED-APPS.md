# Migrated Apps — Knowledge Base

> Written 2026-06-10 at Simon's request when the standalone apps were retired and their
> channels/projects archived. This is the single place that records HOW the retired apps were
> built, their full functionality, and where everything lives now. Companion docs (same repo):
> `QUALITY-INTEGRATION-PLAN.md` and `PALLET-RECORDS-INTEGRATION-PLAN.md` (in the feature branches'
> history) hold the migration play-by-play.

Both apps now live INSIDE this dashboard. One login (Google via Supabase), one sidebar,
role-mirrored access. **The original repos are kept on GitHub as rollback** — restoring either
standalone app = redeploy its repo to its Vercel project (the projects still exist, flipped to
static redirects).

---

## 1. Quality / EQDR (was quality-app-v1.vercel.app)

**Now:** `/quality` section. Old domain = static redirect project (per-path 307s).
**Repo (rollback):** github simondurik-web/quality-app-v1 — deployed branch was
`feature/inspections-pagination-search-analytics`.

**What it is:** Entech Quality Digital Records — hub/tire/finished-product inspection capture with
spec-limit evaluation, NCR (nonconformance) reports, product/limit configuration, audit trail.

**Functionality (all ported):**
- Dashboard counts + recent inspections; Hub/Tire/Finished inspection lists with spec-colored
  measurements (green/amber/red vs limits, ±3% target band) + row-click edit modals (admin).
- New-inspection forms: product dropdown auto-fills `*_target` values from `qa_products`;
  PASS/FAIL selects; comments. NCR form with type→product cascade + atomic numbering.
- ProductAnalytics: product pills, stats cards (avg/min/max vs limits, IN-SPEC/OUT), trend
  AreaCharts with limit lines, compare mode, print report, drawings + 3D GLB viewers.
- Admin: Products CRUD, Limits editor (min/target/max + REQUIRED reason → history table),
  Users (Quality roles), Audit trail.
- Drawings: bucket `photos/drawing/<folder>/*` (fuzzy part→folder match: color-suffix B/G/W
  interchange, -HUB suffix, space→underscore, prefix). 3D: `photos/models-3d/<part>.glb`.

**Data (shared Supabase project mqfjmzqeccufqhisqpij — NOTHING moved):**
`qa_hub_inspections`, `qa_tire_inspections`, `qa_finished_inspections`,
`qa_nonconformance_reports` (number via `qa_next_ncr_number()` RPC + `qa_ncr_counter`),
`qa_products`, `qa_product_limits`, `qa_product_limit_history` (append-only, reason NOT NULL),
`qa_audit_trail`, storage bucket `photos`.

**Access model:** per-user role in `user_app_roles` (app_id=`quality`): visitor/operator/
group_leader/qa_tech/qa_manager/manager/admin. Surfaced as `profile.quality_role`;
client `lib/use-quality-access.ts`, server `lib/quality/guard.ts`. Molding admins + super admin
(simondurik@gmail.com) always in. Products/Users/Audit = quality admin; Limits = manager/qa_manager+.

**CRITICAL GOTCHAS:**
- `product_type` vocabulary is INCONSISTENT by design: `qa_products`/`qa_product_limits` use
  `finished_product`, but `qa_nonconformance_reports` CHECK only allows `finished`. Never
  blanket-normalize; see `toNcrProductType()` in the NCR route.
- Spanish: **Hub and Bore are NOT translated** (crew vocabulary); Grosor not Espesor; ES strings
  came verbatim from the source app's i18n.
- Time-windowed limits were deliberately disabled in the source (2026-05-21): current limit = THE
  limit for all history (`qa_product_limit_history` is audit-only).
- The legacy app's write APIs were UNAUTHENTICATED — any signed-in Google account could insert
  inspections. The port added server guards; retiring the old app closed the hole.

## 2. Pallet Registration / "Production App" (was entech-production-app.vercel.app)

**Now:** `/pallet-records` section (Production / Shipping / Admin) + `/pallet-records/scan` QR
landing. Old Sheets photo viewer renamed **Pallet Photos** (`/pallet-photos`). Old domain = static
redirect project with **/scan query passthrough** (printed QR labels keep working).
**Repo (rollback):** github simondurik-web/entech-production-app (nested at
`entech-production-app/entech-app` in the archived project dir; deployed from `main`).

**What it is:** factory-floor pallet registration + shipping documentation, phone-first PWA used
in Spanish by the crew.

**Functionality (all ported):**
- Production: order list from the Google Sheet Main Data (Active/Completed, search), live
  "Pallets: recorded/required" badges, order detail (Start Order writes a STARTED pallet#0 marker,
  progress bar), pallet form (auto-number = max+1, prefill-from-previous, weight/parts/L/W/H,
  4 camera photos with canvas compression >3MB→2048px q0.8, signed-URL direct upload), admin
  bulk Edit-All grid.
- Shipping: staged-order cards (Sheet status=Staged), pallet-photo DRAFT (carrier NULL) →
  finalize with carrier (one-shot Sheet append on the transition), shopify|other system toggle
  (shopify locks customer "Origen RV Accessories"), 3 photo groups (1200px q0.7, server-proxied
  upload w/ 3 retries), recent shipments (non-admin sees 3 days; own-record 3-day edit window),
  veeqo records silently migrate to shopify on edit.
- Admin: production users (approve/disable/pre-register — pre-register creates the Supabase auth
  user), audit trail with photo-restore + full-row restore (`__restored_from_audit` double-guard),
  push notifications (rewired onto the DASHBOARD's push system — the old app's push table columns
  never existed; its push never worked).
- QR: labels encode `…/pallet-records/scan?line&pallet&total` → localStorage `scan_context` →
  auto-opens the matching pallet form. Dashboard Labels page generates these
  (`lib/label-utils.ts`); the legacy RT-Labels Apps Script inside the Sheet still emits old-URL
  QRs which work via the redirect (optional repoint: Apps Script `QR_APP_URL` ~line 1187).

**Data:** Supabase `pallet_records`, `shipping_records`, `audit_trail`, `users` (SHARED table with
SnapPad portal, discriminated by `app` column = 'production'; roles admin|user, status
active|pending|disabled), `push_subscriptions` (dashboard schema: user_id/endpoint/p256dh/auth),
bucket `pallet-photos` (public, `{if}/pallet-{n}/{ts}.{ext}`).

**GOOGLE SHEET DUAL-WRITES (the load-bearing wall):** the app reads orders from
`Main Data!A:Z` (A=line, F=IF#, H=status, I=PO, J=customer, L=part, P=qty, S=pallets-required)
and WRITES `App Pallet Records!A:Q`, `App Shipping Records!A:P`, and `Main Data!H{row}`
status auto-revert on pallet delete (Completed/Staged→'Work in Progress', never Canceled/Shipped).
Consumers of those tabs: Main Data COUNTIFS, the dashboard's 5-min sync, /pallet-photos, and the
**SnapPad portal** (still live!). The port preserves all writes (`lib/pallets/google.ts`) with
formula-injection sanitization (leading =+-@ gets apostrophe-prefixed). All Sheet + audit writes
are NON-FATAL (a Sheets error never 500s a successful DB write).

**CRITICAL GOTCHAS:**
- Identity fields (`recorded_by`/`edited_by`/`changed_by`) are **auth UUIDs**; display names go in
  `*_by_name`. `audit_trail.changed_by` is uuid-typed — emails make inserts throw.
- Access = the shared `users` TABLE (app='production'), NOT user_app_roles. Client
  `lib/use-pallet-access.ts`, server `lib/pallets/guard.ts`, surfaced as
  `profile.production_access`.
- The legacy app's APIs were unauthenticated with client-trusted `?is_admin=true`; the port added
  real server guards everywhere.
- Legacy routes `app/api/pallet-records/route.ts` + `[id]/*` belong to the OLD photos page
  (/pallet-photos) — pre-existing, distinct from the new `app/api/pallet-records/{orders,pallets,…}`.
- Source repo has a COMMITTED `google-service-account.json` — never reuse; the port uses the
  dashboard's env/secret credential pattern (`lib/google-auth.ts` style, write scope).

## 3. Operational notes (both)

- **Rollback:** redeploy the old repo to its Vercel project (projects exist, currently serving
  static redirects; their framework was PATCHed to null — set it back to Next.js when restoring).
  Data needs nothing: both old and new write the same tables/Sheet.
- **Vercel cutover quirk:** per-deployment `projectSettings` does NOT override an existing
  project's framework — PATCH `/v9/projects/{name}` `{framework:null}` first, then deploy the
  redirect files. CLI tokens expire ~daily; `npx vercel whoami` refreshes.
- **Local build:** `NODE_OPTIONS=--max-old-space-size=6144 npm run build` (three.js graph).
  Codex's sandbox can't fetch Google Fonts or run Turbopack — revert any layout/font/webpack
  "fixes" it makes.
- **Archived project dirs** live in `~/clawd/archive/` (quality-app-v1 incl. its
  entech-quality-app worktree, entech-production-app, molding-qa). Discord channels #molding-qa
  and #entech-app were retired; discussion happens in #molding-dashboard.
