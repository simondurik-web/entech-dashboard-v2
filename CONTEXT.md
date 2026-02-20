# Entech Dashboard V2 - Project Context

Project ID: entech-dashboard-v2
Owner: Simon Durik
Created: 2026-02-07

---

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
