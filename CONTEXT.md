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

## Next Steps (Phase 4+)

1. Add Supabase for persistent storage
2. Implement Google OAuth authentication
3. Add write capabilities (replace Google Forms)
4. Performance optimization (caching, SSG where possible)

## Recent Activity

2026-02-08: Created CONTEXT.md (was missing)
2026-02-07 20:51: Phase 3 complete — all 16 pages with auto-refresh + lightbox
2026-02-07 19:55: Updated HANDOFF.md with resume prompt
2026-02-07 13:12: Project initialized with create-next-app

---

*Last updated: 2026-02-08*
