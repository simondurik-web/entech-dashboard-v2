# Entech Dashboard V2 - Project Context

Project ID: entech-dashboard-v2
Owner: Simon Durik
Created: 2026-02-07

---

## ⚠️ DEPLOYMENT WORKFLOW (MANDATORY — Simon's Requirement 2026-02-21)

**TWO branches. TWO environments. ALWAYS ask before pushing.**

| Branch | URL | Purpose |
|--------|-----|---------|
| `staging` | `entech-dashboard-v2-git-staging-*.vercel.app` | **TEST** — all new features go here first |
| `main` | `entech-dashboard-v2.vercel.app` | **PRODUCTION** — employees use this daily |

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

## Scope

Modern Next.js replacement for the Molding Operations Dashboard. Migrating from static HTML/Google Sheets to:
- Next.js 15 + React + Tailwind + shadcn/ui
- Vercel deployment
- Real-time data via API routes
- Future: Supabase backend, Google OAuth, write capabilities

## Current Status

**Phase 3 Complete** — All 16 pages built with auto-refresh and photo lightbox.

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

## Next Steps — ACTIVE (Supabase Migration)

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

2026-02-19: DataTable standard applied to ALL tables. Custom Views/Reports feature with Supabase backend. Photo lightbox zoom (3x default, 8x max). Reports page in sidebar with full DataTable, inline editable name/notes, direct CSV/Excel export.
2026-02-19: Google OAuth fix, admin panel fixes, super admin hardcoded, photos merge (Sheets+Supabase), sales password removed, EN/ES translation expansion.
2026-02-17: Supabase migration plan created. DB tables already syncing. Ready to start switching API routes.
2026-02-08: Created CONTEXT.md (was missing)
2026-02-07 20:51: Phase 3 complete — all 16 pages with auto-refresh + lightbox
2026-02-07 19:55: Updated HANDOFF.md with resume prompt
2026-02-07 13:12: Project initialized with create-next-app

---

*Last updated: 2026-02-17*

## Recent Activity

2026-02-17: Switched 6 API routes to Supabase with Sheets fallback (sheets, inventory, production-make, all-data, sales, drawings)
2026-02-17: Created lib/supabase.ts + lib/supabase-data.ts (same TS types as Sheets layer)
2026-02-17: Simon added Supabase env vars to Vercel — pending deployment verification
2026-02-17: Remaining routes still on Sheets: pallet-records, staged-records, shipping-records, BOM×3, inventory-history, generic-sheet


## 🚨 CRITICAL: DataTable Standard (2026-02-19)

**EVERY table in the dashboard MUST have the FULL DataTable toolbar:**
- Search bar 🔍
- Reset button 🔄
- Views button (save/share views — see below)
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
1. **Save current view** — column order, hidden columns, sort, filters → saved as a named view
2. **Load a saved view** — click to instantly apply a saved configuration
3. **Share views** — users can share their views with others
4. **Per-user views** — each user sees their own + shared views
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
- Simon picked Option 3 (templates) as best approach — to be built later

2026-02-24 [AUTO-SUMMARY]: Entech Dashboard V2 major feature day
- Automatic Notifications system: Supabase tables + cron endpoint + admin UI, OpenClaw cron every 5 min for urgent/staged order change detection with push notifications
- Requested Date & Due Date columns added to Orders page
- Extra Columns Toggle (`defaultHidden` pattern) added across all order pages: Orders, Need to Package, Staged, Shipped — with shared column registry
- Pallet Load Calculator: SVG viewBox DOOR label cutoff fix + landscape PDF export with forced light colors
- Sales by Date MoM/YoY: 6 comparison columns (Revenue MoM/YoY, P/L MoM/YoY, Margin MoM/YoY), expandable customer rows with sparkline charts, chart tooltip with MoM/YoY data
- Count-up animations fixed on stat cards (AnimatedNumber component now starts from 0 on mount, 2.5s duration)
- Column labels renamed: "Rev MoM" → "Revenue MoM", "Rev YoY" → "Revenue YoY"
- All features deployed to both staging and production

## ⚠️ CODE REVIEW RULE (MANDATORY — Simon's Requirement 2026-02-25)

**ALL code changes must go through the agent fleet review pipeline before pushing.**

### Workflow:
1. Plan the spec (grep files, identify lines)
2. Show Simon the spec
3. Spawn agent via `spawn-agent.sh` OR make the edit directly
4. **Run `review-pr.sh` with at least 2 reviewers (codex + gemini)**
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
