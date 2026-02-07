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

### Milestone 1.3: Next steps
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
│   │   ├── orders/page.tsx ✅
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
│   ├── ui/ ✅ (button, card, input)
│   └── layout/ ✅ (bottom-nav, theme-provider, theme-toggle)
├── GSD-PROJECT.md ✅
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

If Marco's context is reset, read this file first, then:
1. Check GSD-PROJECT.md for full roadmap
2. Continue with Milestone 1.2 (Google Sheets connection)
3. Use Claude Code for heavy coding work
4. Commit frequently, update this PROGRESS.md

---

## 🔗 Quick Links

- **Live App:** https://entech-dashboard-v2.vercel.app
- **GitHub:** https://github.com/simondurik-web/entech-dashboard-v2
- **Vercel Dashboard:** https://vercel.com/simons-projects-849cf04c/entech-dashboard-v2
- **Old Dashboard (reference):** ~/clawd/projects/molding/
- **Google Sheet:** https://docs.google.com/spreadsheets/d/1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw
