# Entech Dashboard V2 - Project Context

Project ID: entech-dashboard-v2
Owner: Simon Durik
Created: 2026-02-07

---

## 🚚 IN PROGRESS — Fulfillment Wrapper (claude-2 via #erp, started 2026-07-02)

Wrap ERPNext shipping (SO → scan pallets → DN → BOL/packing slip) in the dashboard so the
shipping floor never leaves it. Canonical brief + decisions:
`~/clawd/projects/erp-4molding/FULFILLMENT-WRAPPER-BRIEF.md`. ERPNext server-side scripts
(rate-fill from SO, scan gate, shipped rollup) enforce correctness; the dashboard is a thin client.

- **Phase 1 SHIPPED to staging (PR #153, 2026-07-02)** — read-only: Ship Order button on
  /staged (Ready to Ship) → `/staged/ship?so=` (lines, ordered/staged/delivered qtys, item
  pictures via `/api/erpnext/fulfillment/item-image` proxy, staged pallet list; NO prices — floor
  never sees dollar amounts). New `lib/erpnext/fulfillment.ts`; `requireMenuAccess(path)` in
  `lib/erpnext/auth.ts` generalizes `requireInventoryAccess` (same guard, parameterized menu key);
  fulfillment routes gate on `/staged`.
- **Test sandbox**: ERPNext "Test Customer" + SO-00075 + TEST-PLT-1/2 (staged). Manage with
  `erp-4molding/scripts/fulfillment-test-sandbox.py` (create/status/cleanup).
- **Phase 2 SHIPPED to staging (PR #155, 2026-07-02 late)** — scan & check: camera scanner
  (shared PalletScanner remounted per decode) + Type Pallet ID; staged pallets turn green when
  scanned; wrong scans red with reason (`/api/erpnext/fulfillment/pallet` lookup); all-match green
  light → Complete Shipment → confirmation prompt (submit disabled — Phase 3). Fixed the mobile
  card-tap double-fire in `OrderCard` (stopPropagation; DataTable's 6/09 wrapper re-toggled the
  expand state, breaking card expansion on phones for staged/orders/shipped/need-to-package) and
  added an `expandedAction` slot so Ship Order shows inside the expanded card on phones.
- **Phases 3+4 SHIPPED to staging overnight 2026-07-03 (PRs #157/#158/#159)** — Complete
  Shipment is real: DN create+submit through the ERPNext scan gate (so_detail from the
  reservation → correct line on multi-release SOs; reservations consumed/restored natively),
  BOL + "Packing Slip - Entech" PDFs attached (deduped), custom_shipped rollup, shipped view
  (PDF buttons, customer-BOL upload, undo = DN cancel + staging recompute). Idempotent
  double-tap/crash/retry. Shipped section rows get "Shipping documents". GPT-5.5-reviewed
  (8/9 findings fixed; #6 floor-wide undo is per spec, ask Simon about role-restricting).
  Device-tested at iPhone/iPad viewports end-to-end incl. a real UI-driven ship+undo cycle.
  Full build log: erp-4molding/FULFILLMENT-WRAPPER-BRIEF.md.
- **2026-07-03 feedback round (PRs #161/#162)**: ship_loads permission + shipping_team role
  (+ per-permission descriptions in the admin matrix), BOL signature pad (driver name + finger/
  mouse; skippable), fulfillment_log audit trail + Load Log UI, instant status flip on
  complete/undo, ERP shipped rows fixed on Shipped/Orders/Shipping Overview (shipped_date +
  revenue now synced from ERPNext; undo clears; cancelled SOs clear), "Pallets (ERP)" section on
  all expanded order rows (+ /inventory-ops?q= deep link), pallet weight/dims (Batch custom
  fields, Add-form inputs, printed on labels, carried on reprint). Sandbox = SO-00076 staged on
  real pallets JZW3/Q0WX. Sync scripts changed: molding/db-migration sync_erpnext_orders.py +
  sync_erpnext_to_dashboard.py (shipped_date, revenue, Cancelled guard).
- **Pending Simon**: assign users to shipping_team, physical scan test on SO-00076, one real
  order shadowed before floor rollout, then staging → main promotion.

---

## ✅ COMPLETE — API Auth Hardening (claude-3, finished 2026-06-26)

All phases shipped to PROD:
- **Phase 1** — 22 `x-user-id` routes → verified Supabase Bearer JWT (`lib/require-user.ts`); client sends it via `lib/session-token.ts` `authHeaders()`. Service-key path (`x-service-key` vs `PO_AUTOMATION_API_KEY`) for the PO upload scripts.
- **Labels** — label writes → `requireUserOrDevice` (logged-in user OR approved floor device via `x-device-token`).
- **Phase 2a** — every unauthenticated WRITE route locked (BOM, customers, quotes, orders/assign, notifications, pallet-records) + admin/permission checks (`requireAdmin`/`requirePermission`) on the sensitive ones; scheduling migrated off `x-user-id` (`scheduling/_utils.getProfileFromHeader`).
- **Phase 2b** — all shared READ routes gated (`requireReadAccess`); a global client fetch interceptor (`lib/api-fetch-interceptor.ts`, installed from `auth-context`) auto-attaches the token to same-origin `/api/` calls; CDN caching removed from gated routes.
- **Phase 3 (RLS)** — CRITICAL: the `anon`/`authenticated` Postgres roles had full read+write on ~48 tables (public anon key = browser → anyone could read/write the whole business DB directly). Revoked all anon/authenticated writes + reads except 8 browser-read tables (role_permissions, priority_overrides, bom_final_assemblies, qa_*). service-role API + postgres-superuser sync unaffected. Migration: `supabase/migrations/20260626_rls_lockdown_anon_authenticated.sql`. **GOTCHA: shared floor devices are the `anon` role to Supabase (no Supabase login) — that's why anon keeps SELECT on the 8 device-read tables.**
- Cron (`cron/check-order-changes`) already gated via `CRON_SECRET`.
- Codex-reviewed each phase; gemini/grok timed out on the large diffs. PO scripts (`quote_engine._headers`, `release_toter.py`, `attach_po_pdf.py`) updated to send `x-service-key` (po-automation repo). Vercel env `PO_AUTOMATION_API_KEY` set (prod+preview).

Follow-ups (non-urgent): DROP the now-moot permissive RLS policies for cleanliness; consider role-scoped (not just authenticated) RLS if direct client reads ever expand.

---

## 🔐 (historical handoff) → claude-3: API Auth Hardening (2026-06-25)

claude-2 (#erp) handed claude-3 (#molding-dashboard) a security project: **most API
routes trust a spoofable `x-user-id` header instead of the login token.** Full plan,
the 22-route inventory, the `requireUser` pattern, the 3 phases, and the
parallel-work guardrails are in **`docs/API-AUTH-HARDENING-PLAN.md`** — read that first.
**Start with Phase 1** (token-auth the 22 `x-user-id` routes + send the Bearer token
from the client) on branch `security/api-auth-hardening` → staging → 4-agent review →
main. Division of labor: claude-2 stays ERPNext-side; claude-3 owns dashboard-repo work.
Watch-zone: the label API routes (`app/api/labels/*`) overlap label-feature work —
sequence + log here if both are touched. Context: this followed the app-scoped lockdown
+ `blocked` blacklist already shipped to prod (commit `10a6563`).

---

## ⚠️ DEPLOYMENT WORKFLOW (MANDATORY - Simon's Requirement 2026-02-21)

**TWO branches. TWO environments. ALWAYS ask before pushing.**

| Branch | URL | Purpose |
|--------|-----|---------|
| `staging` | `entech-dashboard-v2-git-staging-*.vercel.app` | **TEST** - all new features go here first |
| `main` | `entech-dashboard-v2.vercel.app` | **PRODUCTION** - employees use this daily |

### Rules:
1. **ALL new features → `staging` branch first**
2. **Test and verify on staging URL before merging to main**
3. **Always ask Simon:** "Push to TEST or PRODUCTION?" before any deployment
4. **If risky or complex:** Always default to TEST
5. **To promote:** `git checkout main && git merge staging && git push origin main`
6. **Never push directly to `main`** without Simon's explicit approval

### Vercel Setup:
- Vercel auto-deploys both branches
- `main` = Production deployment
- `staging` = Preview deployment (gets a unique URL)
- Both share the same env vars and API

### **CRITICAL — ALWAYS USE THESE EXACT BRANCHES (2026-04-12)**

**Staging Branch (for TESTING):**
- Branch name: `staging` (NOT `redeploy/add-all-products` or any other branch)
- Staging URL: https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app
- Orders page: https://entech-dashboard-v2-git-staging-simons-projects-849cf04c.vercel.app/orders
- Git command: `git push origin staging` (push to `staging`, not `main`)

**Production Branch (for LIVE):**
- Branch name: `main`
- Production URL: https://entech-dashboard-v2.vercel.app
- Git command: `git push origin main`

**NEVER make this mistake again (2026-04-12):**
- ❌ Committing to wrong branch and assuming it will deploy to staging
- ❌ Creating new temporary branches instead of using `staging`
- ❌ Pushing to `main` without explicit approval from Simon
- ✅ **Always push to `staging` branch for testing**
- ✅ **Always verify the branch is `origin/staging` before claiming it's deployed**

### Pre-push hook — quirk + promotion workaround (2026-04-23)

**The hook:** `.git/hooks/pre-push` (installed 2026-02-25; not versioned) blocks `git push` **while the currently-checked-out branch is `staging`** unless `~/clawd/.clawdbot/.review-approved` exists. This is what forces the feature-branch → PR → 3-agent-review flow (`gh pr merge` is not blocked because it's server-side; the hook only fires on local `git push`).

**The quirk:** the gate is on *current branch*, not on *destination ref*. So if you're sitting on `staging` and try to push **any** ref — including `<sha>:refs/heads/main` — the hook still blocks you.

**Canonical promotion recipe (staging → main) that doesn't trip the hook:**

```bash
# staging already has the verified commits; main is an ancestor.
git fetch origin main staging
git checkout --detach                                   # leave the staging branch
STAGING_SHA=$(git rev-parse origin/staging)
git merge-base --is-ancestor origin/main "$STAGING_SHA" \
  && git push origin "$STAGING_SHA":refs/heads/main \
  || echo "NOT a fast-forward — investigate"
git checkout staging                                    # reattach
```

Notes:
- `git checkout main` from the worktree fails because `main` is already checked out in `~/clawd/projects/entech-dashboard-v2/`. Detach-HEAD sidesteps that cleanly.
- The `is-ancestor` check guards against a non-FF promotion (e.g. if someone pushed directly to main out-of-band).
- `main` has no hook gate — only `staging` does.

**Docs-only change flow** (if you just need to commit docs without touching `staging` locally):

```bash
git checkout -b docs/<slug>
git add <files> && git commit -m "docs: …"
git push -u origin docs/<slug>
gh pr create --base staging --title "…" --body "…"
gh pr merge <N> --merge --delete-branch     # server-side merge, hook not fired
```

## Scope

Modern Next.js replacement for the Molding Operations Dashboard. Migrating from static HTML/Google Sheets to:
- Next.js 15 + React + Tailwind + shadcn/ui
- Vercel deployment
- Real-time data via API routes
- Future: Supabase backend, Google OAuth, write capabilities

## Current Status

**Phase 4 Complete** - Sales Action Center (RollTech email queue) live in production.

---

## ✅ Sales Action Center — Shipped to Production (2026-04-10)

### What it is
Live email thread queue for `rolltech.sales@4entech.com` emails. AI-processed, stored in Supabase `work_email` schema, displayed as an action-oriented queue.

### Features
- **Queue view** — 504 live threads, bucketed by priority type: Reply Today, Internal, Process, Shipping, Wait Cost
- **Detail panel** — thread enrichment: customer, PO, parts, urgency, next action, signals, timeline
- **Digest view** — daily/weekly AI summaries of email activity
- **Quick Actions** — Reply Needed, Waiting on Internal, Waiting on Customer, Ready to Process, Resolve, Mark Noise (dry-run in production until write path is approved)
- **Permission guard** — only users with explicit `/rolltech-actions` permission see the page; removed `/orders` fallback that leaked access to all visitors

### Data pipeline
- Emails → Gmail (rolltech.sales@4entech.com) → `work-email-rolltech` background service → Supabase `work_email` schema
- Tables: `actions`, `action_events`, `v_action_center_queue` (view)
- API routes: `/api/rolltech-actions/queue`, `/api/rolltech-actions/thread/[id]`, `/api/rolltech-actions/mutate`

### Naming
- Route: `/rolltech-actions` (unchanged — avoids breaking bookmarks/permissions)
- Display name: **Sales Action Center** (renamed from RollTech Action Center per Simon 2026-04-10)

### Auth / Supabase
- Supabase Site URL is still set to `snappad-portal.vercel.app` — needs manual change in Supabase Auth → URL Configuration to `entech-dashboard-v2.vercel.app` if login redirect is ever wrong. (Simon flagged, not changed yet.)

### Deployment history (2026-04-08 → 2026-04-10)
1. RollTech Supabase schema + data seeded (Milestone 1)
2. Queue API + live reads (Milestone 2A)
3. Thread detail fetch + hook wiring (Milestone 2B)
4. Write path wiring — QuickActions renders, onMutate wired (Milestone 3)
5. Permission bug fix — removed `/orders` fallback, guests no longer see the page
6. Renamed to Sales Action Center everywhere
7. Staging verified → promoted to production 2026-04-10

---

**Phase 3 Complete** - All 16 pages built with auto-refresh and photo lightbox.

### Live URLs
- **Production:** https://entech-dashboard-v2.vercel.app
- **Dev:** `cd ~/clawd/projects/entech-dashboard-v2 && npm run dev` (port 3000)

### Pages Built (16/16)
- ✅ Orders, Inventory, Shipped, Staged
- ✅ Need to Make, Need to Package
- ✅ Pallet Records, Staged Records, Shipping Records
- ✅ Sales Overview, Sales by Customer, Sales by Part, Sales by Date
- ✅ BOM, Drawings, Quotes
- ✅ FP Reference, Customer Reference
- ✅ Inventory History, All Data

### Features Implemented
- ✅ Data tables with sorting, filtering, search
- ✅ Column toggle (show/hide columns)
- ✅ CSV export
- ✅ Auto-refresh (configurable intervals)
- ✅ Photo lightbox for product images
- ✅ Dark/light theme toggle
- ✅ Language toggle (EN/ES)
- ✅ Mobile-responsive sidebar + bottom nav

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS, shadcn/ui |
| Data | Google Sheets API (read-only) |
| Hosting | Vercel |
| Future | Supabase (auth + write ops) |

## Key Files

| File | Purpose |
|------|---------|
| `GSD-PROJECT.md` | Full project spec and phases |
| `HANDOFF.md` | Resume prompt for new sessions |
| `PROGRESS.md` | Detailed progress log |
| `PARITY-PLAN.md` | Feature parity checklist |

## Data Sources

- Google Sheets (via API routes in `app/api/`)
- Service Account: `marco-workspace@gen-lang-client-0968965845.iam.gserviceaccount.com`

## Key Decisions

- Using App Router (not Pages Router) for Next.js 15
- shadcn/ui for consistent component library
- API routes proxy Google Sheets to avoid CORS
- Auto-refresh at component level, not page level

## Next Steps - ACTIVE (Supabase Migration)

**Full plan:** `SUPABASE-MIGRATION-PLAN.md` (read this first!)

**Priority:**
1. Install @supabase/supabase-js, create lib/supabase.ts + lib/supabase-data.ts
2. Switch API routes from Google Sheets to Supabase (orders, inventory, production-make first)
3. Add Supabase env vars to .env.local and Vercel
4. Fix page issues section by section (Simon will review each)
5. Add write features (urgent toggle, assign worker, status updates)

**Supabase is already set up:**
- Tables: dashboard_orders (2698 rows), inventory (999), production_totals (1077)
- Syncing every 5 min from Google Sheets via cron
- Sync script: ~/clawd/projects/molding/db-migration/sync_sheets_to_db.py
- Anon key reads work, RLS public read policies set

**Simon's directive:** Move fast. This becomes the primary dashboard. HTML dashboard frozen (no new features). All new features go here. Eventually add write-back to stop using spreadsheet for edits.

## Recent Activity

2026-07-14 07:19 (claude-3): Fixed PO-automation quote engine 401 on POST /api/quotes/generate — swapped requireUser → requireUserOrService in app/api/quotes/generate/route.ts (the audited "verified user OR x-service-key" gate already protecting /api/po-automation/documents), per HANDOFF-quote-api-service-auth.md from claude-5. The headless quote engine (no Supabase session, authenticates via x-service-key vs PO_AUTOMATION_API_KEY — confirmed set in Vercel production env) could read /api/customers + /api/customer-products but always 401'd on the write. Human users unaffected: no/invalid service key falls through to requireUser unchanged; route uses auth purely as a boolean gate (no attribution/role use downstream). 4-model review run pre-push per standing rule.

2026-07-11 12:15 (claude-3): MCP server → staging 690d5b4 (Simon approved the build). /api/mcp (stateless Streamable HTTP) exposes 9 READ-ONLY tools (orders / inventory / production / shipping / ERPNext fulfillments / BOM) to Gemini/ChatGPT/Grok/Claude connectors via OAuth 2.1: dynamic client registration (/api/mcp-oauth/register), PKCE-only token endpoint (/api/mcp-oauth/token), /mcp/authorize consent page on the dashboard Google sign-in, HS256 JWT 1h access + rotating hashed refresh tokens, per-request kill-switch + mcp_access re-check (instant revocation), full audit in mcp_request_log. Admin "AI Connectors (MCP)" panel on /admin/users (grant/disable/revoke, kill switch, request log; EN+ES). New RLS-locked tables via scripts/mcp-server-ddl.sql (applied to Supabase). MCP_JWT_SECRET set on Vercel (distinct production/preview values). lib/auth-context signIn(redirectTo?) added; onClick={signIn} call sites wrapped (MouseEvent leak). 4-model review (codex gpt-5.6-sol / gemini / grok 4.5 / self) run pre-push; all blockers + should-fixes applied — details in molding/CONTEXT.md. Follow-up flagged: /api/admin/users isAdmin still uses forgeable user_profiles.email for the super-admin check (pre-existing, untouched here). UPDATE 12:40: Simon approved straight to PRODUCTION (main 3bc8b30, smoke PASS, prod endpoints verified) — connector URL https://entech-dashboard-v2.vercel.app/api/mcp; mcp_access = Simon×2 + Phil (philiphabecker@gmail.com), all full_read (financial + ERP included per Simon: "only me and Phil will use it").

2026-07-10 13:55 (claude-3): Mobile polish (Simon's floor-phone feedback w/ screenshots): ① Pallet Records in OrderDetail — touch devices now get one CARD per pallet (44px edit/delete buttons, whole card opens PalletEditModal) instead of the 6-col table whose 12px icons were unusable; split by @media(hover:none), NOT width (landscape iPhone/iPad > sm still needs cards). Desktop table unchanged. Add/edit/delete handlers extracted+shared; refetch now uses the strict line-scoped filter (old inline refetches could leak sibling-line pallets) + drops stale responses via orderKeyRef. ② PalletEditModal: photo-delete visible on non-hover devices (was group-hover only → impossible on iPhone/iPad), dialog max-h-[85dvh]+scroll so Save is reachable, bigger touch targets. ③ Mobile header: icon-only (no "Entech Dashboard" text), 44px toggle, auto-hides on scroll-down/returns on scroll-up (window scroll listener, rAF-throttled, desktop-gated). pallet-records/admin sticky tab top-14→top-12. ④ VersionBadge deleted entirely. Reviewed by codex gpt-5.6-sol + gemini + self (fixed: capability-vs-breakpoint split, stale-refetch race, rAF cleanup, hit areas). Verified: build green, smoke-gate PASS, Playwright iPhone-14 emulation confirms cards render + hover:none matches + header hide/reveal. Branch feat/mobile-pallet-records-polish → staging 0dd9560. Awaiting Simon's staging check before main.

2026-06-13 14:?? (claude-3): Added inline "+ Add new customer" to the Customer * dropdown in the Customer Reference → Add/Edit Part Mapping modal. Selecting it opens the existing Add Customer dialog (nested Radix Dialog on top of the mapping dialog); on save the new customer is optimistically inserted + auto-selected back into the mapping form, and create errors now surface via toast (was silently swallowed). Bilingual EN+ES (`customerRef.addNewCustomer`). Files: app/(dashboard)/customer-reference/page.tsx, locales/en.json, locales/es.json. Worktree feat/customer-add-inline → pushed to staging f41e8d5 (deploy 5047644787 success). No API/schema changes — reuses POST /api/customers. Awaiting Simon's staging check before main.

2026-06-06 [AUTO-SUMMARY]: Confirmed Employee Scheduling list lives in Supabase `scheduling_employees` table (imported once from Google, no longer syncing — dashboard is source of truth); built "+ Add Employee" button on Scheduling → Employees tab w/ form for Employee ID, first/last name, department, shift, shift length, pay rate, saves directly to `scheduling_employees`; multi-agent review (grok-composer-2.5) done; shipped to staging badge va2f2da4.

2026-06-04 [AUTO-SUMMARY]: Purchasing iterated 06-03 — PR #137 prod (show-all-cols default, dropdown-scroll fix via JS-managed scroll bypassing dialog scroll-lock); PR #138 Vanessa save fix (guard reads per-app role); PR #139 prod — editable Status dropdown audited, redundant cols removed, status quick-filter buttons, Item+Paperwork photo sections w/ restore, receive flow w/ photo warning + auto Received by, editable Notes; PR #140 phone gallery picker; PR #141 Add-photo buttons moved left.

2026-06-03 [AUTO-SUMMARY]: ES Maza→Hub and Rodamientos→Baleros translations shipped to prod; Shipping Overview cards fill viewport at any zoom (flex layout replacing hardcoded vh calc); Label reprint w/ packaging selector (Pallet/Box/Gaylord) + qty edit shipped to prod; new role-gated Purchasing section under Tools&Reference — 4,739 rows from "All Data Combined" sheet w/ replicated auto-calc cols, default Molding+Melt-only filter, landscape iPhone shows full scrollable table, searchable dropdowns for Dept/SubDept/Requestor/DeliverTo/ReceivedBy.

2026-06-02 18:35 UTC: **Shipping Overview viewport-fill** shipped to prod across PRs #133 + #134 + #135 (promote PR #136). The two cards (Ready to Ship / Shipped) now stretch to the bottom of the visible viewport instead of leaving empty space below. Three-step diagnosis: (1) PR #133 swapped the hard-coded `100vh − 210px` for flex-fill (`flex-1 min-h-0` on the grid container, `shrink-0` on the header, outer flips to `h-screen` at wide); (2) PR #134 added `min-[1400px]:grid-rows-1` because CSS Grid's default `grid-auto-rows: auto` kept the row short even when the container was tall; (3) PR #135 exposed the dashboard layout's `zoomLevel` as a `--app-zoom` CSS custom property on `<main>` and switched the page's height constraints to `calc(100vh / var(--app-zoom, 1))` so it fills at any in-app zoom (Simon uses 65–70%). Two memos saved so future-me catches both gotchas at once: `reference_css_grid_height_fill_gotcha`, `reference_entech_dashboard_css_zoom_vh_gotcha`.

2026-06-02 14:44 UTC: **Label reprint flow** — packaging type selector + "Reprint" verb (PRs #131→staging, #132 promote→main, prod Ready). Generate Labels dialog's expanded detail row now has a Type-of-Packaging dropdown with Pallet / Box / Gaylord Box / Other (free-text); empty selector preserves the sheet's default. API: new optional `custom_packaging_type: Record<line, string>` on POST /api/labels; activity log notes the override. Action button label flipped from "Regenerate" → "Reprint" on rows with existing labels (shop-floor verb). 10 new i18n keys EN+ES shipped together (locale parity 571/571). Files: `app/api/labels/route.ts`, `components/labels/GenerateLabelsDialog.tsx`, `locales/{en,es}.json`.

2026-06-02 13:25 UTC: **ES "Baleros" promoted to main** — PR #129 (`table.bearings` "Rodamientos" → "Baleros") merged to staging 2026-05-31, promoted via PR #130 today, prod Ready.

2026-05-31 13:54 UTC: **ES i18n shop-floor terminology** — `table.hub` "Maza" → "Hub" and `table.hubMold` "Molde de Maza" → "Molde de Hub" (PRs #127→staging, #128 promote→main, prod Ready). Aligns ES with EN (which already said "Hub"); team uses the English word regardless of language. New rule saved to memory: never share preview/alias URLs for Vercel verification — always merge to staging and point Simon at the canonical staging URL.

2026-04-23: **FP Reference — BOM expand row** shipped to production via PR #100. Mirrors the customer-reference pattern: chevron next to `Part number` expands into the shared `<BomExpandPanel/>`; `Tire` and `Hub` cells now render inventory popover + drawing icon inline. Has-BOM vs no-BOM is glanceable (filled primary chevron + green left stripe vs muted grey dash). Stats strip shows With-BOM / Without-BOM counts. Page grew from 90 LOC dumb-passthrough to 257 LOC with full expansion wiring; zero component duplication — reused `BomExpandPanel`, `DrawingIconButton`, `InventoryPopover`, `fetchBomMaps` as-is. Three special-cased sheet headers matched by `===` ('Part number', 'Tire', 'Hub'); all other columns pass through generic render so sheet layout can evolve without touching this code. Full 3-agent review (Codex 5.4 + Gemini 3.1 + Opus 4.7 ultrathink) found 3 must-fix items — all landed in commit `4f0c50e` before merge: (1) chevron `title`/`aria-label` now flip to `customerRef.collapseRow` when expanded (a11y parity with customer-reference), (2) WeakMap-based row keys so duplicate PNs don't expand together and empty PNs don't phantom-toggle, (3) empty-PN rows skip the chevron entirely. Tire short-code lookups confirmed working against `/api/inventory` + `/api/drawings` (same pattern /orders, /staged, /need-to-package, /drawings use). Locale parity 496 / 496. Detailed handoff in `HANDOFF-fp-reference-bom-expand.md`.
2026-04-22→23: **Customer Reference — BOM expand row** shipped to production across 2 PRs (#96, #97). Clicking the chevron next to an Internal P/N opens a BOM-Explorer-styled two-column panel below the row: components table (Part · Source · Qty · Unit · Ext Cost) with per-row inventory popover (reuses `<InventoryPopover/>`) + drawing carousel (prev/next + thumbnail strip + arrow-key nav), and a read-only Cost Breakdown card (Subtotal, Overhead%, Admin%, Depreciation%, Repairs%, Variable, Total, Sales Target). Tier resolution: final → sub → individual, with a small amber "+N" collision badge when a PN matches in multiple tiers. No BOM Explorer or API changes. All new strings shipped in both `en.json` + `es.json` same commit (492/492 parity). Full 3-agent review (Codex 5.4 + Gemini 3.1 + Opus 4.7 ultrathink) caught a drawings-shape bug before merge: `/api/drawings` returns `drawingUrls: string[]`, not `drawing1Url`/`drawing2Url` — commit `ffbcf71` on PR #96 fixed it. New global rule persisted this session: bilingual products must ship all features in all locales in the same commit; rule saved to `~/.claude/CLAUDE.md`, `~/clawd/LESSONS.md`, and auto-memory. Detailed session handoff in `HANDOFF-customer-ref-bom-expand.md`.
2026-04-17: **Cost Change Log — full rollout to production** (`main` at `eaee639`). Built across 5 PRs (#91–#95):
- **#91** — New "Cost Change Log" tab on BOM Explorer (`app/(dashboard)/bom/page.tsx`, 4th tab). Unified timeline of cost + lead-time changes across all item types. New endpoint `GET /api/bom/cost-history` on `bom_cost_history_with_details`. Expandable rows show `affected_assemblies`. Migration `20260417_bom_lead_time_tracking.sql` extends the individual-item trigger to also record `lead_time` changes.
- **#92 / #95** — `.github/workflows/staging-alias.yml` GitHub Action that re-aliases `entech-dashboard-v2-git-staging-*.vercel.app` to the latest staging deployment on every push. Permanent fix for Vercel's drifting auto-branch-alias. `VERCEL_TOKEN` secret wired (permanent `vcp_` token). Workflow uses `dpl_` deployment ID (not URL — the URL form 404s); treats HTTP 409 `not_modified` as idempotent success.
- **#93** — Fixed "All Types" filter showing only finals (6717 finals vs 776 sub vs 134 individual dominated the top-500 window). Now runs balanced per-type queries and merges by date. Cost Change Log tab refactored to use the dashboard's standard `DataTable` + `useDataTable`, so it now has per-column sort, per-column filter dropdowns, column toggle/reorder, CSV/Excel export, and search synced to the BOM top-level search box — matching every other table in the app.
- **#94** — User attribution for cost changes. Migration `20260418_bom_cost_history_user_attribution.sql` adds `changed_by_email` + `changed_by_name` columns + recreates the `bom_cost_history_with_details` view. New helper `lib/bom-cost-history-attribution.ts` → `attributeCostHistory(sinceIso, email, name)` UPDATEs unattributed trigger-inserted rows within the request's time window. Wired into individual/sub/final/lead-time API routes (and inside `after()` for the async cascade so propagated rows get attributed too). The Cost Change Log "By" column and the per-item `CostHistoryPanel` now show email (with name in tooltip), falling back to "(system)" for pre-attribution rows.
- Both migrations (20260417 + 20260418) applied to Supabase prod via Management API. Specs: `specs/cost-change-log.md` (phases 1–3 tracked; user-attribution added post-spec, recorded here).
2026-04-13 [NIGHTLY]: Next.js 15 dashboard architecture research produced one concrete recommendation for V2: stop defaulting top-level routes to `'use client'`. Because Next.js 15 page navigations are less cache-forgiving and request APIs are more explicitly async, V2 should move to server-rendered page shells with client islands for DataTable controls, charts, modals, and auto-refresh. Highest-value migration targets: `sales-overview`, `orders`, and `rolltech-actions`, all of which are currently full-page client components.
2026-04-16 [NIGHTLY]: Dense-table motion guidance for V2 got more specific: do not add row-level CSS scroll-driven animations to operational tables. `components/data-table/DataTable.tsx` already has the right guardrails (`motion.tr` only for small sets, expandable-row animation preserved). Next step should be stability hardening instead: add `scrollbar-gutter: stable` to the overflow container, use Motion `layoutScroll` only if the table wrapper itself starts participating in layout animation, and keep motion budget focused on sticky progress/header cues plus expand/collapse clarity.
2026-04-18 [NIGHTLY]: Partial-index research produced one concrete database recommendation for V2: use partial indexes only on small, hot operational slices with stable literal predicates, not on broad generic report filters. Best first target is the Sales Action Center / `work_email.actions` workload, using one composite partial index around the unresolved/active queue sorted by recency or priority, then verifying with `EXPLAIN` before adding anything else.
2026-04-19 [NIGHTLY]: Chart.js large-dataset research produced one concrete charting recommendation for V2: do not send huge raw trend series straight to the browser. For production-history line charts, pre-shape data server-side, use `parsing: false` + `normalized: true` + `animation: false`, and enable decimation with `min-max` for spike-sensitive manufacturing charts or `lttb` for zoomed-out trend summaries.
2026-04-20 [NIGHTLY]: Reduced-motion accessibility research produced one concrete UI rule for V2: treat reduced motion as a system-level mode, not a CSS patch. Best implementation path is to wrap the dashboard shell in Motion `reducedMotion="user"`, keep opacity/color/state cues, and explicitly degrade sidebar/drawer travel, table movement, chart refresh animation, autoplay media, and any future scroll/parallax polish to fade-or-static behavior when the OS preference is enabled.
2026-04-12 [NIGHTLY]: Waffle-chart research produced one clear recommendation for dashboard KPI cards: if we add yield/scrap visualization, start with the tiny zero-dependency `waffle-chart` package for 2-3 value cards (good/scrap/downtime) instead of adopting a heavy chart stack. Re-evaluate `@nivo/waffle` only if V2 wants a broader unified charting system with legends/theming/canvas variants.
2026-04-09 [AUTO-SUMMARY]: RollTech Action Center staging review found the current page was still largely seed/mock-driven, with search limited to local sample data, customer_name mostly null, and phone numbers being misclassified as part numbers upstream. Simon approved an Opus-driven implementation plan to finish the real staging version, with 15-minute milestone checks via cron. Active implementation phases launched included fixing part-number extraction, deriving customer/contact fields from canonical email data, and wiring a live `/api/rolltech-actions` route before staging QA.

2026-02-19: DataTable standard applied to ALL tables. Custom Views/Reports feature with Supabase backend. Photo lightbox zoom (3x default, 8x max). Reports page in sidebar with full DataTable, inline editable name/notes, direct CSV/Excel export.
2026-02-19: Google OAuth fix, admin panel fixes, super admin hardcoded, photos merge (Sheets+Supabase), sales password removed, EN/ES translation expansion.
2026-02-17: Supabase migration plan created. DB tables already syncing. Ready to start switching API routes.
2026-02-08: Created CONTEXT.md (was missing)
2026-02-07 20:51: Phase 3 complete - all 16 pages with auto-refresh + lightbox
2026-02-07 19:55: Updated HANDOFF.md with resume prompt
2026-02-07 13:12: Project initialized with create-next-app

---

*Last updated: 2026-02-17*

## Recent Activity

2026-02-17: Switched 6 API routes to Supabase with Sheets fallback (sheets, inventory, production-make, all-data, sales, drawings)
2026-02-17: Created lib/supabase.ts + lib/supabase-data.ts (same TS types as Sheets layer)
2026-02-17: Simon added Supabase env vars to Vercel - pending deployment verification
2026-02-17: Remaining routes still on Sheets: pallet-records, staged-records, shipping-records, BOM×3, inventory-history, generic-sheet
2026-02-27 [AUTO-SUMMARY]: Scheduling system fully shipped to production (10 PRs #11-#21, 3,360 LOC). Weekly grid, shift assignment, employee management, copy/revert, full audit trail. Audit Log Viewer (PR #22) and Spanish URL param + dark theme default (PR #23) deployed to staging, awaiting production push.
2026-02-28 [AUTO-SUMMARY]: PRs #22-#23 still on staging awaiting Simon's verification. Session backed up with continuation prompt for audit log viewer task.
2026-03-01 [AUTO-SUMMARY]: Dynamic drawings feature shipped (PRs #31-32 → main, 3-agent review). Inventory department filter hotfix deployed — spreadsheet columns had shifted, now uses dynamic header-row lookup (PR #34). Started Supabase migration for inventory: created `inventory_reference` (709 items) + `inventory_history` (107K records) tables, daily sync cron at 6AM EST, API routes updated with Supabase-first/Sheets-fallback (PR #35 → staging). Marco admitted not following coding policy (coded directly instead of delegating to agents) — CODING-POLICY.md now saved to project and loaded automatically in boot sequence.
2026-03-02 [AUTO-SUMMARY]: Workspace housekeeping — MEMORY.md trimmed from 30K to 5K chars (-83%), AGENTS.md from 20K to 6K chars (-69%), archive created at memory/archive/MEMORY-ARCHIVE-2026-03-01.md. LaunchAgent for OpenClaw gateway fixed (was broken plist). OpenClaw Studio browser UI requires HTTPS or localhost (not plain HTTP over LAN).
2026-03-04 [AUTO-SUMMARY]: BOM features planned — Add Sub-Assembly, Add Final Assembly, and Edit Existing Assembly dialogs with component pickers, auto-cost cascade. Simon approved plan, agent to deploy to staging first. Agent failed on execution (timeout + auth errors on all 3 model fallbacks) — task pending retry.
2026-03-04 [AUTO-SUMMARY]: Permission bug fix — `canAccess()` in `use-permissions.ts` was doing exact string matching only; `/quotes/new` had no `menu_access` entry (only `/quotes`) → Phil got "Access Denied". Fix: added parent path walk-up logic (PR #37). Deployed staging, tested, then pushed to production same day with Simon's approval.
2026-03-06 [AUTO-SUMMARY]: Assigned 14 Origen RV Accessories orders to Joseles (3/5/2026). Initial Supabase update got wiped by Sheet→Supabase sync — lesson learned: must write to Google Sheet directly (columns AV/AW, rows 2772-2785) when Sheet is source of truth. Supabase-only updates get overwritten by sync job.
2026-03-08 [AUTO-SUMMARY]: Dashboard AI architecture discussion for Phil. Recommendation is to start with a constrained Gemini API assistant inside the dashboard — retrieval-backed Q&A, natural-language reports, limited approved business actions (e.g. urgent override, quote drafting), and structured issue/request submission to Marco/Simon. Keep full OpenClaw as the internal escalation/management layer only; do not expose code-changing power or system access to Phil-facing AI.
2026-03-10 [NIGHTLY]: Research watchlist refreshed. Most relevant items for Dashboard V2 right now: Vercel AI Gateway now supports OpenAI Responses API directly; Vercel also added custom MCP server support in v0 and continues investing in agentic tooling; Supabase is leaning further into ETL/analytics/vector storage, which may matter if dashboard reporting or AI retrieval grows heavier.
2026-03-10 [AUTO-SUMMARY]: Sales profitability qty-aware follow-up is NOT on staging yet. PR #41 (`review/sales-cost-qty-fix`) is dirty/conflicting because it was branched from `main`; clean recovery branch `review/sales-cost-qty-fix-clean` was created from current `staging` and is being manually re-ported.
2026-03-10 [AUTO-SUMMARY]: Remaining clean-port scope called out explicitly: `app/api/sales/route.ts`, `lib/supabase-data.ts`, `app/(dashboard)/sales-customers/page.tsx`, `app/(dashboard)/sales-parts/page.tsx`, `app/(dashboard)/sales-dates/page.tsx`, plus tests. Estimate given to Simon: ~30–60 minutes if the clean port behaves.
2026-03-10 [AUTO-SUMMARY]: Sales profitability postmortem + deployment complete. Root cause was two stacked issues: (1) cost-basis mismatch — some views displayed Total Cost while still using legacy `pl` / variable-basis profit logic; (2) unit-scale mismatch — per-unit `variableCost` / `totalCost` were compared against total order revenue without multiplying by quantity. Fixes were delivered in two stages: PR #39 corrected total-vs-variable basis mismatch, export margin aggregation, profit-per-part consistency, and zero-revenue loss-row preservation; PR #42 made sales profitability qty-aware, aligned Sales by Customer / Part / Date views and drilldowns with order-total cost math, and added regression tests for the exact screenshot-style failure cases. Staging merged at `1e3fee7`; production promoted to `main` at `17b7809` with Simon's explicit approval after staging looked correct.
2026-03-11 [NIGHTLY]: Research watchlist still favors Vercel AI Gateway + Responses API, Supabase ETL/analytics/vector bucket direction, and low-cost/offline voice systems. Brave web_search is still unconfigured on this OpenClaw host, so browser/X/direct-fetch research remains the reliable fallback path for automated briefings.
2026-03-14 [NIGHTLY]: Relevant ecosystem notes — Vercel AI Elements 1.9 shipped agent-facing UI primitives + screenshot-aware prompt input; Vercel Flags gained stronger agent/webhook tooling; Supabase changelog highlights faster large-dataset Storage listing and stricter recursive Edge Function rate limiting. Useful for future internal assistant + rollout safety planning, no code changes made.
2026-03-15 [NIGHTLY]: Follow-up watch items — Supabase still deprecates anon-key schema/OpenAPI access for existing projects on 2026-04-08; verify no dashboard tooling depends on client-side `/rest/v1/` schema introspection. No app code changes made.
2026-03-15 [AUTO-SUMMARY]: BOM performance work shipped to staging then production after Simon approved promotion.
- Added short-lived cache headers to BOM + inventory API routes and a longer cache on the sales API route to cut repeated serverless work.
- Replaced BOM recalculation N+1 loops with batch upserts to reduce DB round-trips.
- Added post-mutation cache-busting (`?t=` / bust flag) so edits still show immediately after writes.
- Final status reported: production live with lower Vercel CPU usage.
2026-03-16 [NIGHTLY]: Ecosystem watch — Vercel next-forge 6 and Flags agent tooling continue pushing agent-native app scaffolding and rollout control; Supabase changelog emphasizes AI-assisted table filters plus Storage performance/security work. No app code changes made.
2026-03-17 [NIGHTLY]: Watch items — Vercel now supports LiteLLM server on Vercel AI Gateway, which could simplify future internal assistant routing. Supabase also formalized recursive Edge Function rate limits, so future agent/job chains should stay queue-based rather than function-to-function fan-out. No app code changes made.
2026-04-07 12:43: Simon explicitly approved the cross-project handoff from `work-email-rolltech` into this dashboard project to begin the first RollTech Customer Action Center UI scope. Approved initial scope only: queue screen, bucket counts, action list, selected-thread detail panel, quick state-change actions, and digest preview panel. RollTech Phase 8 validation passed 8/9 checks on 1,854 emails; remaining known issue is edge-case thread rollups.
2026-06-25 [claude-3] API Auth Hardening Phase 1 — DONE on branch `security/api-auth-hardening` (off staging). Added `lib/require-user.ts` (verifies the Supabase Bearer JWT via `auth.getUser`) + `lib/session-token.ts` (client module-level token cache → synchronous `authHeaders()`). Converted all 22 `x-user-id` API routes to derive identity from the verified token instead of the spoofable header (admin/{devices,permissions,users}, chat/phil, labels/{route,[id],activity,settings}, notifications/log, orders/priority, po-automation/{route,[id],documents,toter-portal}, purchasing/{route,[id],options,photos,[id]/photos}, rolltech-actions/mutate, views/{route,[id]}). Updated ~23 client fetch callers to send `Authorization: Bearer` via `authHeaders()` (purchasing form/page useMemo→useCallback to avoid stale-token freeze; PriorityOverride already sent Bearer, just dropped dead x-user-id). Left quality/scheduling/pallet-records callers untouched (their routes still read x-user-id — out of Phase-1 scope). `tsc` clean (only pre-existing missing-native-dep errors); no new eslint errors. WATCH-ZONE: labels API routes (`app/api/labels/*`) overlap active `feat/label-redesign` (entech-dashboard-v2-pallet worktree) — hardening touched server + label clients (labels/page, GenerateLabelsDialog, LabelSettings, need-to-package, orders); sequence/rebase if both land. NOT yet on staging/main — awaiting Simon's go for staging deploy + the 4-agent review before any main promotion. Phases 2 (ungated routes) + 3 (RLS) still pending.
2026-06-25 [claude-3] ⚠️ DEPLOY PREREQ found during Phase 1 — two PO-automation scripts in claude-5's repo (`po-automation/toter-portal/release_toter.py`, `po-automation/orchestrator/attach_po_pdf.py`) POST the BOL / PO-PDF to `/api/po-automation/documents` server-side with a hardcoded `x-user-id` (the exact spoof vector being closed) and NO Supabase session → they'd 401 once this hits prod. Added a service-key escape hatch: `requireUserOrService()` in `lib/require-user.ts` (constant-time match of `x-service-key` vs env `PO_AUTOMATION_API_KEY`, mirroring the existing price-lookup key pattern), wired into the documents route only. BEFORE MAIN PROMOTION (coordinate w/ claude-5): (1) set `PO_AUTOMATION_API_KEY` on Vercel **production** (and staging for parity); (2) add the same secret to the scripts' env + have both scripts send `-H "x-service-key: <key>"` alongside their existing `x-user-id`. Staging testing is NOT affected — both scripts hit the hardcoded prod URL, so the staging deploy can't break BOL upload. This is the labels watch-zone's sibling: a po-automation cross-repo overlap, logged here per the parallel-work guardrails.
2026-06-25 [claude-3] Phase 1 SHIPPED — staging (cc84826, click-tested by Simon, OK) → **main/PROD live** (entech-dashboard-v2.vercel.app, build green). 4-agent review done (codex+gemini+opus; grok hung) → all valid findings fixed (token race, constant-time key, service-call role-skip, dead-code). Labels write routes left OPEN per Simon (option 1; close in Phase 2 w/ device-session handling). ⚠️ PENDING: `PO_AUTOMATION_API_KEY` must be added to Vercel (Production+Preview) + a prod redeploy, or claude-5's BOL/PO-PDF auto-upload 401s — value in ~/clawd/secrets/po-automation-service.env; the 2 scripts (release_toter.py, attach_po_pdf.py, committed in po-automation 4c63111) already send it as x-service-key. claude-3's Vercel token expired → Simon to set the env (UI) or hand a fresh token. NEXT: Phase 2 (ungated routes: sheets, all-data, bom/individual-items, scheduling GET, notifications/send) + Phase 3 (RLS audit).


## 🚨 CRITICAL: DataTable Standard (2026-02-19)

**EVERY table in the dashboard MUST have the FULL DataTable toolbar:**
- Search bar 🔍
- Reset button 🔄
- Views button (save/share views - see below)
- Columns button (hide/show)
- Export button (CSV + Excel)
- Sort on every column ↕️
- Filter on every column 🔽
- Column reorder (drag & drop)

**This applies to ALL tables including:**
- Main tables on every page
- Sub-tables when expanding a row (e.g., orders within a part)
- Sub-sub-tables (e.g., orders for a customer within a part)
- Customer group tables within expanded parts

**NO EXCEPTIONS.** If it's a table, it gets the full DataTable treatment.

### Views Feature (Priority: HIGH)
The "Views" button (currently shows "Soon") should allow:
1. **Save current view** - column order, hidden columns, sort, filters → saved as a named view
2. **Load a saved view** - click to instantly apply a saved configuration
3. **Share views** - users can share their views with others
4. **Per-user views** - each user sees their own + shared views
5. **Storage:** Supabase `saved_views` table with: id, user_id, page, name, config (JSON), shared (bool), created_at
6. **Config JSON:** { columnOrder, hiddenColumns, sortKey, sortDir, filters }

### Excel Export Formatting (GLOBAL)
- Currency columns → $#,##0.00 (Revenue, Cost, P/L, Price, Profit, etc.)
- Number columns → #,##0 (Qty, Orders, etc.)
- Right-aligned numbers
- This is in `lib/export-utils.ts` (global) and also in sales-parts local `downloadExcel`

### Current Issue (2026-02-19)
- Sales by Part: customer-level table (when multiple customers for a part) is still a raw HTML table
- Needs conversion to full DataTable component with all features
- The order-level tables ARE DataTables already

## Future: Custom Report Builder (tabled 2026-02-21)
- Idea: dedicated Reports page with saved presets (Monthly Sales, Inventory, Full Export)
- Each preset generates a multi-tab Excel with custom formatting, totals, dashboard tab
- Options discussed: per-section buttons, global report page, templates, scheduled emails
- Simon picked Option 3 (templates) as best approach - to be built later

2026-02-24 [AUTO-SUMMARY]: Entech Dashboard V2 major feature day
- Automatic Notifications system: Supabase tables + cron endpoint + admin UI, OpenClaw cron every 5 min for urgent/staged order change detection with push notifications
- Requested Date & Due Date columns added to Orders page
- Extra Columns Toggle (`defaultHidden` pattern) added across all order pages: Orders, Need to Package, Staged, Shipped - with shared column registry
- Pallet Load Calculator: SVG viewBox DOOR label cutoff fix + landscape PDF export with forced light colors
- Sales by Date MoM/YoY: 6 comparison columns (Revenue MoM/YoY, P/L MoM/YoY, Margin MoM/YoY), expandable customer rows with sparkline charts, chart tooltip with MoM/YoY data
- Count-up animations fixed on stat cards (AnimatedNumber component now starts from 0 on mount, 2.5s duration)
- Column labels renamed: "Rev MoM" → "Revenue MoM", "Rev YoY" → "Revenue YoY"
- All features deployed to both staging and production

## ⚠️ CODE REVIEW RULE (MANDATORY - Simon's Requirement 2026-02-25)

**ALL code changes must go through the agent fleet review pipeline before pushing.**

### Workflow:
1. Plan the spec (grep files, identify lines)
2. Show Simon the spec
3. Spawn agent via `spawn-agent.sh` OR make the edit directly
4. **Run `review-pr.sh` with ALL 3 reviewers (codex + gemini + claude-code)**
5. Show Simon the review summary
6. Push to **staging only**
7. Wait for Simon's approval before production

### No exceptions. Even for:
- Small fixes (< 20 lines)
- CSS/formatting changes
- Adding table rows or text
- "Obviously correct" changes

### Why:
- Catches rounding bugs, edge cases, pre-existing issues
- Creates audit trail
- Safer for production (employees use this daily)
- Simon explicitly requested this on 2026-02-25

### Git Workflow (Corrected 2026-02-25):
1. Create feature branch: `git checkout -b feat/description`
2. Make changes and commit
3. Push feature branch: `git push origin feat/description`
4. Create PR: `gh pr create --base staging --fill`
5. Run review: `review-pr.sh --pr <NUMBER> --reviewers codex,gemini`
6. Show Simon the review summary
7. Merge PR to staging (after review passes)
8. Simon tests on staging URL
9. Simon approves → merge staging to main
10. **NEVER push directly to staging or main**
2026-02-25 [AUTO-SUMMARY]: Migrated all Google Sheets access from public gviz to authenticated API v4 (PR #6)
- Critical bug found by Codex review: header row included as data - fixed in `toGvizShape`
- Gemini review found 4 more gviz routes (sales, quotes, cron) - all migrated to centralized `fetchSheetData`
- Root cause: Simon removed public link sharing, breaking gviz endpoint; fix uses service account auth
- TypeScript compiles clean; PR #6 ready for Vercel preview → staging → production
- Claude Code OAuth expired - fell back to Codex + Gemini for reviews
- Exec policy changed to "full" - production deploys now gated by conversation approval
- Deployment approval rule established: must message Simon and get explicit "yes" before pushing to main
2026-03-31 [AUTO-SUMMARY]: Customer Reference duplicate button bug fixed — root cause was `-COPY` appended to internal P/N causing API validation failure, error silently swallowed. Fix: `-COPY` goes on customer P/N instead, errors now show toast notifications. Vercel staging deploy was broken (canceled build had staging alias) — manually reassigned alias. Simon approved and fix pushed to production.
2026-03-31 [AUTO-SUMMARY]: BOM auto-quantity formulas deployed (PR #81, branch `review/bom-auto-qty`). 880 packaging components tagged with formulas. Quantities auto-calculate from `parts_per_package` using patterns: PALLET=1/PPP, CLEARFILMCOVER=3/PPP, BAG=1/PPP, FILM-STRETCH=500/PPP. Manual components (KWH, LABOR) untouched. Amazon Fulfillment Center orders now auto-assign to Joseles (same as Origen RV and Technoflex). Modal scroll bug fixed — Lenis smooth scroll was hijacking wheel events globally; now pauses when Radix dialog opens via `data-scroll-locked` attribute.

2026-04-16 [AUTO-SUMMARY]: BOM Cost Change Tracking migration complete (database backend). Added `lead_time` column to individual items for future purchasing agent workflow. Created `bom_cost_history` table with automatic triggers tracking cost changes on all 3 BOM tables (individual items, sub-assemblies, final assemblies). Backfilled 2,601 initial history records. Created 4 views for dashboard integration: `bom_latest_costs`, `bom_cost_history_with_details`, `bom_cost_change_stats`, `bom_recent_cost_changes`. Migration files committed to git (20260415_bom_change_tracking.sql, 20260416_bom_cost_tracking_triggers_views.sql). Merged to main and synced staging to main. UI plan created in `specs/bom-cost-history-ui.md` (14-17 hours estimated for full implementation including lead time input, cost history display, and chart visualization). Database changes already live - ready for UI development.

2026-07-08 [claude-2 via #erp]: Tire/Hub colors + ERPNext minimums (PR #214, staging). Root cause of the all-red Tire/Hub columns: the ERPNext order sync leaves the sheet-era have_tire/have_hub booleans NULL. Replaced with live logic (lib/component-availability.ts): per tire/hub, demand = sum qty of open orders (pending/WIP, unshipped); green only if stock >= demand AND >= minimum. Popover shows "Needed (Open Orders)". Manual Target removed everywhere (dead sheet column; also dropped `target` from InventoryItem). Minimums now live in ERPNext Item.safety_stock (282 backfilled from production_totals): editable inline on /inventory (inventory-ops permission) via new POST /api/erpnext/inventory/minimum (writes ERPNext + mirrors Supabase inventory.minimum), or directly on the ERPNext Item form; the 5-min sync (molding/db-migration/sync_erpnext_inventory.py) carries safety_stock for every enabled item — Supabase inventory.minimum NULL = item not in ERPNext (falls back to frozen sheet minimums). ERPNext role 'Dashboard Inventory Service' granted scoped read+write on Item (re-apply: erp-4molding/scripts/erpnext-custom-2026-07-07/04_dashboard_item_minimum_perm.py). Simon still to review the red/green rule wording ("below minimums" case) when awake.

2026-07-08 [claude-2 via #erp — full-day session, ALL PROMOTED TO PRODUCTION through PR #233]:
- Need to Make rewired to live ERPNext data (PR #218): stock+minimums from the ERP feed; Parts to Make = max(0, max(minimum, open-order demand) − available); "Needed (Open Orders)" column.
- Minimums governance (PR #219): edit_minimums permission (manager/shipping_manager/admin), minimum_change_log audit table + "Minimum Changes" viewer on /inventory, EditableMinimum on /inventory + /need-to-make + InventoryPopover (popover cache extracted to lib/inventory-cache.ts).
- On Hand / Committed / Available on every inventory surface (PR #221): inventory.on_hand_total/reserved_staged/available; INVARIANT: inStock/fusionInventory = AVAILABLE so committed stock never covers other orders.
- Reserved-pallet ops fixes (PR #223): reprint releases the SO reservation BEFORE reissue (ERPNext v15 refuses to move reserved stock) then re-reserves the new serial; 409s name a failed_pre_erp holder (action + error); remove got the friendly family pre-check. Lock semantics unchanged.
- Phone cards (PR #225): tap-to-expand desktop-parity detail + availability colors on Need to Make / Need to Package / Orders Data (components/cards/OrderSpecsGrid.tsx).
- Label speed (PR #226/#227): ^PR2 → ^PR3 (2 in/s welded ribbon on dense QR blocks). Shipping ZT411's panel darkness was found at +30 (max) and set to 18 remotely via a print_jobs ~SD18 job — that was the real ribbon-sticking cause.
- Scanner reprint suffix (PR #228): camera extraction kept only the base32 run, so 33R5-02 scanned as retired 33R5 → "old/replaced" rejections; suffix-aware pattern.
- Multi-release shipping (PR #230): Ship Order state is release-scoped — scan flow renders whenever pallets are staged; "Previous shipments" strip (per-DN BOL/packing + signed); "Release shipped" vs full "Shipment complete" (SO fully delivered only); per-line staged/scanned attribution via reservation soDetail; shippedPallets = union across DNs; new fulfillment fields previousShipments[].
- Scan parsing centralized (PR #232): lib/pallet-code.ts + lib/pallet-code.test.ts (node --test) is the ONLY place scan payloads become pallet ids — convention in docs/inventory-ops.md.
- Ops notes: pallet 5TJQ's stuck failed_pre_erp row cleared via the documented escape hatch; "missing Pallets (ERP) section" reports = stale browser tab (verified role access is fine) — first remedy is refresh.

2026-07-09 [claude-2 via #erp — overnight build, ON STAGING (PR #235), awaiting Simon's morning review]: TRUCKLOADS — multi-SO loads locked to one truck (incident: Phil's 4-load truck left with 1 DN because the plan lived in screenshots). Supabase truckloads/truckload_orders/ship_sessions (RLS default-deny, applied to prod DB) + manage_truckloads grant (manager/shipping_manager; NO sales role exists). Calculator "Create Truckload" snapshots full state incl. SVG diagram; violet "Ships together" banners + TruckloadsPanel (edit/cancel/load-sheet) on /staged + /shipping-overview; ship flow hard-blocks member orders w/ manager override (own perms or manager email+password re-auth, logged tl_release); ?tl= chained flow ships each member (own DN/packing slip), ends with ONE signature fanned to every DN via sign-bol; ship_sessions saves after EVERY scan → refresh/battery/Wi-Fi-proof resume cross-device (also single-order mode — fixes the refresh-restart incident); copies selector default 2 (pdf-lib page duplication for AirPrint via document?copies=, N print_jobs rows for relay — relay path not physically printed yet). ERPNext (Simon-approved decision 5): DN custom_truckload_no + TRUCKLOAD badge on BOL + Packing Slip formats (pre-edit backup: erp-4molding/shipping-customizations/backups/print-formats-backup-20260708.json). E2E on live ERP Test Customer sandbox TL-0001 (SO-00095/96/97 → DN-00052/53; SO-00097 released via override): mid-scan refresh restore verified, TL badge + signature on the real BOL PDF verified, 2-copy PDF verified; EN+ES @390×844. Full handoff: erp-4molding/TRUCKLOAD-HANDOFF-2026-07-08.md. Gotcha for testers: after restarting `next start`, the first browser load can serve stale cached chunks — reload once before judging.

2026-07-09 [claude-2 via #erp — launch-day session, ALL IN PRODUCTION through PR #245]: Truckloads promoted to prod (PR #237) on Simon's morning GO; Phil created TL-0002 (5 Homecare orders) unprompted the same morning. Same-day follow-ups, each staging→main immediately: load sheet pallet counts + total (#238/#239, truckload_orders.pallet_count backfilled); LINE-SCOPED truckloads (#240/#241 — critical: a truckload entry is ONE dashboard line, not the whole SO; Phil linked only line 3714 of SO-00020 but the SO-scoped flow bannered sibling line 3715 AND would have demanded all 9 staged pallets in one DN, blocking the truck. truckload_orders.line + erp_order_line_map→SO Item resolved SERVER-side scopes scan+DN to exactly the member line's pallets; scan sessions/chips keyed per member order_key; shipping-overview banner+card boxed in a violet ring — adjacency had made SO-00101 look like a member); filterable Truckload column on Ready to Ship (#242/#243); load sheet IF column dropped + live per-line Pallet IDs from reservations (#244/#245).
Data/ERP ops the same day (bench python as Administrator, all audit-commented): SO-00069 (PO-140, 3 destinations in one migrated SO, header said Oakley CA) split into SO-00098/99/100 with correct per-destination ship-to; ship-to migration audit found 29/84 open SOs carrying the customer's DEFAULT address — all 20 still-to-ship repointed (list + before/after PDFs in erp-4molding repo); SO-00091 line item SPK1→SPK1-1PK; SO-00071 split 11/1 pallets into SO-00071+SO-00101 (CSS9 freed for relabel).
GOTCHAS learned the hard way: erpnext update_child_qty_rate CANCELS ALL the SO's Stock Reservation Entries (SO-00071/91 lost every staged pallet mid-morning — all re-reserved + verified; rule now in LESSONS.md); the ERP→dashboard sync numbers new dashboard_orders lines max(line)+1, so the overnight sandbox rows at 909x pushed real orders to 9104 until everything was renumbered back into sequence (SO-00101=4027, sandbox=4024-4026); the sync creates its own rows for direct-entry SOs (~30 min) — never insert dashboard_orders rows manually.

2026-07-09 [claude-2 via #erp — afternoon fix, IN PRODUCTION (PRs #253/#254)]: TRUCKLOAD FINISH FLOW made recoverable. Incident: TL-0002's crew (Abel) confirmed the 5th order and left — the driver-sign screen only existed in that instant and NOTHING linked back to /staged/ship?tl= afterwards (shipped orders leave Ready to Ship, banners gone, panel had no link), so all 5 BOLs went unsigned and Phil printed 10 documents by hand from each order. Fixes: (1) TruckloadsPanel button on every non-canceled TL — "Load / Scan" while active, "Sign / Documents" once shipped; (2) completion screen fetches each DN's real signed state — sign pad (driver name + signature) shows whenever ANY BOL is unsigned regardless of session, signs only the unsigned ones, per-DN "Signed" chips; (3) ONE "Print everything" button queues packing slip + BOL for EVERY order (×copies) at the letter station — per Simon: no per-order printing at the end of a truckload; (4) transient truckload refresh failure no longer blanks the completion panel (fatal error only when nothing loaded yet); (5) driver name typed at the finish persists to the ship session again (save was gated on an active scan bucket, which is '' once all members are done). Verified locally against prod data at 390×844 with a throwaway shipping_team user (deleted after): TL-0002 revisit shows the 5-BOL sign pad, TL-0001 (already signed) shows docs + Signed chips + "Print everything (4 documents)". EN+ES same commit.

2026-07-09 [claude-2 via #erp — late-evening feedback round, IN PRODUCTION (PRs #258/#259)]: (1) Ready to Ship: Pallet Load Calculator + Truckloads buttons moved from page bottom to above the table (shipping team couldn't find them); (2) Priority chip rendered "PP1" — effectivePriority already arrives "P1"-style, renderer stopped double-prefixing (URGENT string values also routed to the urgent chip); (3) LINE-SCOPED SHIPPING PHOTOS on Shipping Overview: ship-day photos (shipment/paperwork/close-up) were matched by IF number so a multi-release SO's still-staged line wore the shipped line's paperwork (SO-00020: staged 3715 showed shipped 3714's photos). shipping_records.line_number was captured all along — overview now matches line-first, IF-wide fallback restricted to SHIPPED orders. Verified against prod data locally.
ERP inventory audit the same evening (Simon: "why does SHIP-OUT-233 show 8,448 pcs with no pallets?"): full bin-vs-batch-vs-reservation sweep of all 1,170 stocked item/bin combos. ONLY phantom found = demo stock whose batches were DISABLED without issuing the stock out (disabling hides batches from pallet queries but keeps warehouse qty): 8,448 of 620.308.2211 (CASC-37ENT000-P01..24, Cascade demo 6/19) + 540 STK1 stickers (ORIGEN-* demo) in SHIP-OUT-233.B1.CR2.EM, + 1 pc (QE62) in Finished Goods. Cleaned via Material Issues MAT-STE-2026-04738..41 (re-enable → issue → re-disable), SHIP-OUT-233 now zero. 620.308.2211 true on-hand 8,766; dashboard Committed (8,698, SRE-based) was always right. Rule going forward: NEVER disable a batch that still holds stock — issue it out first. Non-serialized items (EB-/CURB- packs) legitimately show bin qty without pallet IDs; Bin.reserved_qty (classic SO bookkeeping vs Raw Materials) is ERPNext-internal noise, SREs live in Bin.reserved_stock.

2026-07-10 [claude-2 via #erp — morning, IN PRODUCTION (PRs #262/#263)]: TRUCKLOAD GUARDS. (1) one LINE = one truckload — calculator Link Orders picker disables lines already on an active TL (violet "Already on TL-xxxx" badge), panel add-picker excludes them, and the server rejects reused lines on create + add (new conflictingOrderLines in lib/truckloads.ts — the order_key guard alone can't disambiguate multi-release lines; gap shown by TL-0004/SO-00067). (2) one CUSTOMER per truck — first linked order narrows the calculator picker to that customer (violet banner, EN+ES), panel add-picker narrows to the TL's customer, server 409s mixed-customer creates/adds (distinctCustomers; PATCH accounts for removed-then-added keys). Verified against prod data locally + API guard matrix with the Test Customer sandbox SOs (throwaway TL-0005 canceled). Sandbox note: SO-00104..108 synced as dashboard lines 4033-4047 for Simon's line-scoped truckload testing.

2026-07-10 [claude-2 via #erp — midday, IN PRODUCTION (PRs #266/#267)]: TruckloadsPanel scale-up — pinned search bar (matches TL number / customer / SO / IF / DN / part / notes / creator, works with Show closed), list scrolls under the pinned header (data-lenis-prevent + overscroll-contain), and a customer chip on every load card (one truck = one customer since #262, first member's customer names the load). Same session, ERP side: Test Customer FULLY torn down on Simon's order — 10 SOs + 9 DNs + all SREs cancelled, 25 dashboard rows flipped cancelled (lines stay burned; next real line = 4048), TEST-* sandbox batches AND the 9 re-edited-label pallets the DN cancels had restored (JZW3/Q0WX/9WRR/GHDF/TFP6/C8XM/NA59/THRB/X7BC, 1,140 pcs) issued out + disabled (MAT-STE-2026-04900..12), 5 test pallet_records deleted. Simon confirmed items 308/201/254's OUT-bin stock is real tire inventory — untouched. Shipping-station printers swapped the same morning (new ZT411 99N224401559 + Canon MF450, queues repointed, radios off, ~SD18, relay E2E verified).

2026-07-11 [claude-2 via #erp — morning, IN PRODUCTION (PRs #270/#271)]: (1) PALLET ACTIVITY → WIP: recording a pallet (floor photo flow app/api/pallet-records/pallets POST or manual entry [id] POST) now flips dashboard_orders.work_order_status to 'wip' via lib/pallets/api.markOrderInProgress — the intended mechanism existed as /api/pallet-records/orders/start but NOTHING ever called it (Simon expected "first pallet recorded → Making" since the beginning). Never downgrades completed/staged/loaded/shipped, never resurrects cancelled. (2) OrderDetail "Pallets (ERP)" section was SO-wide — a two-product SO mixed the sibling line's pallets into every card (SO-00038: .1911 card listed the .2211 pallets, 13 mixed). Now filtered to the card's partNumber (staged + shipped lists); note: strict item filter means an item-swapped line (SPK1→SPK1-1PK style) shows none of the swapped pallets — manage via inventory-ops if that ever bites. iMessage-for-Phil question ANSWERED + TABLED by Simon (hybrid recommended when revisited; BlueBubbles/imsg legacy skills are the listen path, scoped to one group chat GUID).

2026-07-11 [claude-2 via #erp — midday, IN PRODUCTION (PRs #274 staging / #275 DIRECT to main)]: PHIL ASSISTANT FOR APPROVED DEVICES — the Tesla browser is paired in authorized_devices with role manager, but device sessions run on a pseudo-profile with NO Supabase user and both gates were user-only (page `!user`; /api/chat/phil requireUser+user_profiles). Page now gates on profile; the chat API authenticates via requireUserOrDevice and runs canAccessPhil on the device's admin-assigned role (loadActorContext); chat history keys on the device uuid (per-device thread). DB: DROPPED the auth.users FKs on phil_chat_history.user_id + phil_jobs.user_id (device uuids aren't auth users; FKs only provided delete-cascade). Verified on a pure device session locally (API 200 + full chat UI as manager device; throwaway authorized_devices row deleted after).
⚠️ BRANCH STATE: staging carries claude-3's UNPROMOTED feat/mcp-server work (14+ files) — do NOT blind-promote staging→main until claude-3 releases it; ship hotfixes via main-based branches with direct-to-main PRs (pattern used here), and ALSO merge them to staging to keep it a superset.
