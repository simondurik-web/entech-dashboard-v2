# Entech Dashboard V2 - Progress Tracker

**Last Updated:** 2026-02-07
**Current Phase:** 1 (Foundation)
**Context Reset Safe:** ✅ Yes

---

## ✅ Completed

### Milestone 1.2: Google Sheets Connection (DONE)
- [x] Created lib/google-sheets.ts with data fetching
- [x] Created /api/sheets endpoint
- [x] Orders page fetches real data from Google Sheets
- [x] Filter chips working (All/Urgent/Due/RollTech/Molding/SnapPad)
- [x] Loading spinner while fetching
- [x] Status-based color coding
- [x] Staged page connected — filters orders with status "Staged"
- [x] Staged page has search + filter chips (All/Roll Tech/Molding/Snap Pad)
- [x] Created /api/inventory endpoint (merges Fusion Export + Production Data Totals)
- [x] Inventory page connected — shows part numbers, stock, minimums, % progress bars
- [x] Inventory page has search + filter chips (All/Low Stock/Needs Production)
- [x] Deployed and live at https://entech-dashboard-v2.vercel.app/orders

### Milestone 1.1: Project Scaffold (DONE)
- [x] Next.js 14 + App Router created
- [x] Tailwind CSS + shadcn/ui configured
- [x] Theme toggle (dark/light) with next-themes
- [x] Bottom navigation component
- [x] Dashboard layout
- [x] Placeholder pages: /orders, /staged, /inventory
- [x] GitHub repo: simondurik-web/entech-dashboard-v2
- [x] Deployed to Vercel: https://entech-dashboard-v2.vercel.app
- [x] Build passing, 0% error rate

---

## 🔄 In Progress

### Phase 2: Feature Parity (Started 2026-02-07)

**Wave 1 — Claude Code (Infrastructure)**
- [x] DataTable component system (sorting, filtering, visibility) ✅ DONE 2026-02-07
- [x] Sidebar navigation ✅ DONE 2026-02-07

**Wave 2 — Pages**
- [x] Need to Make page ✅ DONE 2026-02-07
- [x] Need to Package page ✅ DONE 2026-02-07
- [x] Shipped page ✅ DONE 2026-02-07

**Wave 3 — Charts & Records**
- [x] Inventory History page (recharts) ✅ DONE 2026-02-07
- [x] Pallet Records page (Codex) ✅ DONE 2026-02-07
- [x] Shipping Records page (Codex) ✅ DONE 2026-02-07
- [x] Staged Records page (Codex) ✅ DONE 2026-02-07

See `PHASE-2-WORKFLOW.md` for full plan.

### Milestone 1.3: Next steps (deferred)
- [ ] Add pull-to-refresh or auto-refresh
- [ ] Add detail views for orders/inventory items
- [ ] Chat/AI assistant integration

**Google Sheet ID:** `1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw`

**Key Tabs:**
- Main Data (GID 290032634) - All orders
- Fusion Export (GID 1805754553) - Inventory
- Production Data Totals (GID 148810546) - Minimums/targets

---

## 📁 Project Structure

```
~/clawd/projects/entech-dashboard-v2/
├── app/
│   ├── (dashboard)/
│   │   ├── orders/page.tsx ✅ (uses DataTable)
│   │   ├── staged/page.tsx ✅
│   │   ├── inventory/page.tsx ✅
│   │   └── layout.tsx ✅
│   ├── api/
│   │   ├── sheets/route.ts ✅
│   │   ├── inventory/route.ts ✅
│   │   ├── chat/ (TODO)
│   │   └── auth/ (TODO)
│   ├── layout.tsx ✅
│   └── page.tsx ✅
├── components/
│   ├── data-table/ ✅ NEW (2026-02-07)
│   │   ├── DataTable.tsx (main component)
│   │   ├── ColumnFilter.tsx (multi-select filter)
│   │   ├── ColumnToggle.tsx (show/hide columns)
│   │   ├── ExportCSV.tsx (CSV export button)
│   │   └── index.ts (barrel export)
│   ├── ui/ ✅ (button, card, input, popover, checkbox)
│   └── layout/ ✅ (bottom-nav, theme-provider, theme-toggle)
├── lib/
│   ├── use-data-table.ts ✅ NEW (sort, filter, search hook)
│   ├── export-csv.ts ✅ NEW (CSV utility)
│   └── google-sheets.ts ✅
├── GSD-PROJECT.md ✅
├── PHASE-2-WORKFLOW.md ✅ NEW (full feature parity plan)
└── PROGRESS.md ✅ (this file)
```

---

## 🔧 Tech Stack

- **Framework:** Next.js 16.1.6
- **React:** 19.2.3
- **Styling:** Tailwind CSS 4 + shadcn/ui
- **Theme:** next-themes 0.4.6
- **Hosting:** Vercel (Hobby tier)
- **Repo:** github.com/simondurik-web/entech-dashboard-v2

---

## 📝 Notes for Next Session

**RESUME HERE (2026-02-07 16:30 EST):**

✅ **Completed today:**
- Sidebar navigation (Wave 1)
- Need to Make page (Wave 2)
- Need to Package page (Wave 2)
- Shipped page (Wave 2)
- Inventory History page with charts (Wave 3)
- Pallet Records page (Codex)
- Shipping Records page (Codex)
- Staged Records page (Codex)
- Language system (i18n EN/ES toggle) ✅
- Drawings Library page (Codex) ✅
- Image Modal component (Codex) ✅
- BOM Explorer page ✅

🎉 **Phase 2 Feature Parity: COMPLETE**

**All 18 pages building successfully!**

**✅ Bug fix (2026-02-07 17:30 EST):**
- Added `normalizeStatus()` function for consistent status handling
- Cancelled/closed/void orders now filtered out from all views
- Status detection matches original dashboard logic

**✅ Expandable Order Rows (2026-02-07 17:45 EST):**
- New `components/OrderDetail.tsx` - shows pallet details + photos + shipping info
- DataTable now supports expandable rows (getRowKey, expandedRowKey, onRowClick, renderExpandedContent)
- Orders page: click any row/card to expand and see pallet weight, dimensions, photos
- Shipped orders also show carrier, BOL, pallet count
- Smooth 300ms expand/collapse animation
- Works on both desktop table and mobile cards

**Remaining polish (optional):**
- Connect real drawing URLs from Google Sheets
- Connect real BOM data from Google Sheets
- Add photo gallery integration to records pages
- Pull-to-refresh / auto-refresh

**Reference:** Old dashboard at `~/clawd/projects/molding/molding_dashboard_production.html`

**Agent config:**
- Claude Code: `env -u ANTHROPIC_API_KEY claude -p "task" --print --max-turns 25 --permission-mode bypassPermissions`
- Codex 5.3: `codex exec --full-auto "task"` (already configured in ~/.codex/config.toml)
- Always use `pty: true` when calling from Clawdbot

---

## 🔗 Quick Links

- **Live App:** https://entech-dashboard-v2.vercel.app
- **GitHub:** https://github.com/simondurik-web/entech-dashboard-v2
- **Vercel Dashboard:** https://vercel.com/simons-projects-849cf04c/entech-dashboard-v2
- **Old Dashboard (reference):** ~/clawd/projects/molding/
- **Google Sheet:** https://docs.google.com/spreadsheets/d/1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw
