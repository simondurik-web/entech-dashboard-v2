# Quality (EODR) → Molding Dashboard Integration Plan

## STATUS / CHECKPOINT
- Worktree: `~/clawd/projects/quality-integration` · branch `feat/quality-integration` (off `staging`).
- **Phase 1 ✅ DONE** (reviewed by 4 agents, fixed): profile API `quality_role` overlay,
  `lib/use-quality-access.ts`, AccessGuard `/quality` gating, Sidebar QUALITY section, EN+ES.
- **Phase 2 ✅ DONE + ON STAGING** (reviewed by 3 agents, all blockers fixed; build+tsc clean):
  real Quality dashboard (counts + recent), Hub/Tire/Finished/NCR lists on the molding DataTable,
  spec-color helpers (`lib/quality/limits.ts` + `components/quality/badges.tsx`), `lib/quality/fetch.ts`.
  Staging branch fast-forwarded to `bdd12cb`; live at
  https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/quality
  Key fix: finished spec limits use product_type `finished_product` (not `finished`); all QA fetches
  gated on `canSeeQuality`.
- **NEXT → Phase 3**: data-entry forms (new hub/tire/finished inspection + NCR) and admin screens
  (Products, Limits, Users, Audit) — currently the `quality/[...slug]` catch-all shows "coming soon".
  These need guarded `/api/quality/*` write routes (server-side `canManageQuality`/`canEditLimits`,
  copy lib/purchasing/guard.ts pattern). Then Phase 4 theme polish, Phase 5 verify, Phase 6 retire EQDR.
- **Phase 1 fleet review DONE** (4 agents: Codex GPT-5.5 + 3 Claude — security/correctness/design).
  (Phase 2 review: Codex + 2 Claude — fixes in commit `bdd12cb`.)
  Verdicts: 3× SHIP, 1× FIX-FIRST (Codex). No blocker, no regression confirmed by all four.
  Fixes applied (commit pending): (1) `grantedByDashboard` now requires authenticated non-visitor
  (closes visitor-grant footgun); (2) catch-all `quality/[...slug]` placeholder kills 404s on
  not-yet-built sub-routes; (3) AccessGuard uses exact-or-child path matching; (4) EODR→EQDR comment
  typos; (5) Quality entries added to command palette gated by QA role. (agy/Gemini was unavailable —
  Antigravity binary missing — so the 4th reviewer was Codex, not Gemini.)
- **DEFERRED to Phase 2 (security prerequisites, documented):**
  - `/api/quality/*` data routes MUST enforce server-side auth (copy lib/purchasing/guard.ts pattern);
    Phase 1 has no API routes so client-only gating leaks nothing yet.
  - AuthProvider clears `loading` before `fetchProfile` resolves, and AccessGuard renders children
    while loading → Phase 2 data pages must self-gate their data fetches, not rely on AccessGuard.
- **NEXT → Phase 2**: port the real screens (Quality dashboard counts+recent, Hub/Tire/Finished
  inspection lists, NCR list) onto the molding DataTable standard, EN+ES. Delegate bulk port to
  Codex per CODING-POLICY; Opus reviews. Then fleet review → push to staging → Simon tests.
- Source app to port from: `~/clawd/projects/quality-app-v1` (branch
  feature/inspections-pagination-search-analytics). Same Supabase project — reuse molding's clients.

---

> Created 2026-06-09 by claude-3. Decision baseline from Simon:
> **Q1=a** (single home — fold Quality in, retire standalone EQDR after parity),
> **Q2** (same access as today's QA users — mirror QA roles, don't re-assign),
> **Q3** (full feature port, but staging-first for Simon to review/test).

## Goal
Bring the entire Quality system (EODR / "Entech Quality Digital Records", currently at
`quality-app-v1.vercel.app`) into the molding dashboard (`entech-dashboard-v2`) as a native
**Quality** section in the sidebar — same shell, same login, instant "back" to any molding page
by clicking another menu item. After verified parity on staging, the standalone EQDR app is retired.

## Why this is low-risk
- **Same Supabase project** (`mqfjmzqeccufqhisqpij`) — Quality data (`qa_hub_inspections`,
  `qa_tire_inspections`, `qa_finished_inspections`, `qa_nonconformance_reports`, `qa_products`,
  `qa_product_limits`, `qa_product_limit_history`, `qa_audit_trail`) is already in the DB the molding
  app uses. **No data migration. We move screens, not data.**
- **Identical stack** — both Next.js 16 / React 19 / Tailwind 4 / shadcn/ui, both auth via the same
  Supabase Google OAuth. The user's session already works for both.
- Quality app is small: ~69 source files, 9 page routes, ~10 API routes.

## Architecture decision
Quality pages live under the molding app's existing dashboard route group so they inherit the
molding shell (sidebar + top bar + theme + i18n) automatically:

```
app/(dashboard)/quality/
  page.tsx              # Quality dashboard (counts + recent inspections)
  hubs/page.tsx         + hubs/new/page.tsx
  tires/page.tsx        + tires/new/page.tsx
  finished/page.tsx     + finished/new/page.tsx
  ncr/page.tsx          + ncr/new/page.tsx
  products/page.tsx     # admin
  limits/page.tsx       # QA manager+
  audit/page.tsx        # admin
  users/page.tsx        # (see Open Decision #1)
app/api/quality/...     # ported API routes (service-role + server-auth)
```
"Back to molding" needs **no special handling** — it's one app; every other sidebar item is a soft nav.

## Access / permissions mirror (Q2)
Two role systems are involved, both already in this Supabase DB:
- **Molding** uses `role_permissions` (role → `menu_access` path map) + `user_app_roles` overlay
  (app="dashboard") + `custom_permissions`. Consumed by `usePermissions().canAccess(path)`
  (`lib/use-permissions.ts`). Admin/super_admin = always allowed. Sub-path matching means granting
  `/quality` covers all `/quality/*`.
- **Quality** uses `user_profiles.role` + `user_app_roles` overlay (app="quality"). Roles seen in
  EQDR User Management: visitor, operator, group_leader, qa_tech, qa_manager, manager, admin.

**Recommended approach (zero re-assignment, exactly "the same emails"):**
Gate the Quality **section + in-section admin pages** on the user's **quality role** =
`overlayAppRole(user, app="quality")` — the *same data* that drives today's EQDR User Management
screen. So every QA user keeps the access they have today, automatically.
- Sidebar shows the Quality section if quality-role is non-visitor (or molding admin).
- Inside Quality: Products/Users/Audit = QA admin; Limits = QA manager+/admin (+ `simondurik@gmail.com`),
  mirroring the standalone app's current gating exactly.
- Also register `/quality` in `role_permissions` so it's manageable from `/admin/permissions`, and so
  molding admins/managers can be granted Quality access there too. (Belt and suspenders: access =
  QA-role OR molding role_permissions grant.)

This honors Simon's "use the same access as the emails in the QA" while still surfacing it in the
molding role-permission UI he already has.

## Phased build (all to `staging`)

**Phase 0 — Prep**
- Branch `feat/quality-integration` off `staging`.
- Confirm env vars already present in entech-dashboard-v2 (NEXT_PUBLIC_SUPABASE_URL/ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY) — they are (same project). Add any QA-only vars if found.
- Finalize Open Decisions below.

**Phase 1 — Shell + nav + access (the "click in / click back" skeleton)**
- Add `(dashboard)/quality/page.tsx` placeholder so the route renders inside the molding shell.
- Add a **QUALITY** collapsible section to `components/layout/Sidebar.tsx` (desktop + mobile blocks):
  Dashboard, Hub Inspections, Tire Inspections, Finished Products, NCR Reports, and (admin) Products,
  Limits, Audit, Users. Filter by the QA-role/`canAccess` logic above.
- Implement quality-role resolver (reuse/extend `overlayAppRole` for app="quality").
- Seed `role_permissions` with `/quality` for appropriate roles via Supabase Management API.

**Phase 2 — Read/browse screens**
- Port Quality Dashboard (totals + recent inspections), Hub/Tire/Finished inspection lists, NCR list.
- Reuse molding's shared `supabase` client; port GET API routes to `app/api/quality/*`.
- Convert tables to the molding **DataTable standard** (project rule: full toolbar — search, reset,
  views, columns, export, sort, filter, drag reorder).
- Merge QA translations into molding i18n under a `quality.*` namespace — **EN + ES both** (bilingual rule).

**Phase 3 — Data-entry + admin**
- Port New Inspection forms (hubs/tires/finished/new), NCR creation, Products config, Limits editor,
  Audit trail, and Users (per Open Decision #1). Port POST/PUT API routes with service-role +
  `server-auth` token verification.
- Reuse limits-lookup spec validation + audit logging (`logCreate`/`logUpdate`).

**Phase 4 — Styling/theme reconciliation**
- QA app is dark-only with `.glass-card`, custom oklch CSS vars. Molding supports light/dark.
  Map QA components onto molding theme tokens so they render correctly in both themes. Drop QA's
  global `.dark`-on-`<html>` and `:root` gradient (would override molding). Namespace any colliding
  CSS vars/utilities.

**Phase 5 — Verify on staging**
- 3-agent fleet review BEFORE pushing to staging (project rule + standing rule).
- Headless smoke on staging: desktop + mobile (390×844) per mobile-hardening rule.
- Test as: a QA-role user (operator/group leader), a molding visitor (should NOT see Quality),
  a QA admin, and Simon. Verify in-section admin gating, EN/ES, DataTable toolbar.
- Simon reviews on canonical staging URL.

**Phase 6 — Cutover (after Simon's sign-off)**
- Promote staging → main (detached-HEAD recipe per pre-push hook quirk; Simon's explicit yes required).
- Retire standalone EQDR: point `quality-app-v1.vercel.app` to a redirect → molding `/quality`, or
  decommission. Update Supabase Auth `uri_allow_list` if any redirect changes.
- Update CONTEXT.md activity log + memory.

## Open decisions to confirm with Simon
1. **Users management:** keep a Quality "Users" screen (manages app="quality" roles, so QA managers
   keep assigning QA roles) OR fold QA user/role assignment into molding's `/admin/users` +
   `/admin/permissions`? (Recommend: keep a Quality Users screen scoped to QA roles — least disruption.)
2. **EQDR retirement timing:** redirect immediately after cutover, or run both in parallel for a grace
   period? (Recommend: short parallel grace period, then redirect.)
3. **3D models / drawings** (`/api/models3d`, `/api/drawings`, `public/drawing-index.json`): port as-is.
   Confirm storage buckets (`photos`, `models3d`) are reachable from molding app (same project — should be).

## Maintenance note
Because we retire EQDR (Q1=a), there is **no code fork** — Quality lives only in entech-dashboard-v2
after cutover. This is the whole reason Option A beats a proxy/multi-zone embed for this case.
