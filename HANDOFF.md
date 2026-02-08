# Entech Dashboard V2 — Handoff Document

**Created:** 2026-02-07 18:51 EST
**Purpose:** Resume after memory reset

---

## 🚀 RESUME PROMPT

Copy and paste this to Marco after restart:

```
Resume the Entech Dashboard V2 project. Read:
- ~/clawd/projects/entech-dashboard-v2/HANDOFF.md
- ~/clawd/projects/entech-dashboard-v2/PROGRESS.md

The project is 95% complete. Phase 2 feature parity is done. All pages are built and deployed.

What's left:
1. "All Data (raw)" page - shows everything from Main Data sheet
2. Any polish/fixes I request

Dev server runs on port 3051. Live at https://entech-dashboard-v2.vercel.app
```

---

## 📋 PROJECT STATUS

**Phase 2 Feature Parity: ✅ COMPLETE (100%)**

### What's Built & Working

| Page | Route | Data Source | Status |
|------|-------|-------------|--------|
| Orders | `/orders` | Main Data (GID 290032634) | ✅ Live |
| Staged | `/staged` | Main Data (filtered) | ✅ Live |
| Shipped | `/shipped` | Main Data (filtered) | ✅ Live |
| Inventory | `/inventory` | Fusion Export + Prod Totals | ✅ Live |
| Need to Make | `/need-to-make` | Main Data (filtered) | ✅ Live |
| Need to Package | `/need-to-package` | Main Data (filtered) | ✅ Live |
| Inventory History | `/inventory-history` | Inventory History (GID 171540940) | ✅ Live |
| Pallet Records | `/pallet-records` | Pallet Records (GID 1653474547) | ✅ Live |
| Shipping Records | `/shipping-records` | Shipping Records (GID 1428628940) | ✅ Live |
| Staged Records | `/staged-records` | Staged Records (GID 962295313) | ✅ Live |
| BOM Explorer | `/bom-explorer` | BOM Final (GID 1818327795) | ✅ Live |
| Drawings Library | `/drawings` | Stub (needs GID) | ⚠️ Stub |
| FP Reference | `/fp-reference` | FP Reference (GID 944406361) | ✅ Live |
| Customer Reference | `/customer-reference` | Customer Ref (GID 336333220) | ✅ Live |
| Quotes Registry | `/quotes` | Quotes (GID 1279128282) | ✅ Live |

### Key Features Implemented
- **DataTable component** — sorting, filtering, column visibility, CSV export
- **Sidebar navigation** — collapsible, grouped sections
- **Expandable order rows** — click to see pallet details, photos, shipping info
- **Refresh buttons** — on all main pages
- **Language toggle** — EN/ES (i18n system)
- **Dark/Light theme** — persisted
- **Charts** — Inventory History with date picker, multi-part select, line/bar charts
- **Generic sheet API** — `/api/generic-sheet?gid=...` fetches any sheet tab dynamically

### Remaining
1. ~~**All Data (raw) page**~~ ✅ **DONE 2026-02-07**
2. **Drawings** — needs actual GID if separate from FP Reference (currently using Production Data Totals)

---

## 🔧 TECHNICAL DETAILS

### Project Location
```
~/clawd/projects/entech-dashboard-v2/
```

### Dev Server
```bash
cd ~/clawd/projects/entech-dashboard-v2
npm run dev  # Runs on port 3051
```

### Deployment
- **Live URL:** https://entech-dashboard-v2.vercel.app
- **Deploys automatically** on push to main branch
- **Vercel project:** simons-projects-849cf04c/entech-dashboard-v2

### GitHub
```bash
cd ~/clawd/projects/entech-dashboard-v2
git status
git add -A && git commit -m "message" && git push
```

### Google Sheets
- **Sheet ID:** `1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw`
- **Service Account:** `marco-workspace@gen-lang-client-0968965845.iam.gserviceaccount.com`
- **Credentials:** `~/clawd/secrets/google-service-account.json`

### Key GIDs (Sheet Tabs)
| Tab | GID |
|-----|-----|
| Main Data | 290032634 |
| Fusion Export | 1805754553 |
| Production Data Totals | 148810546 |
| Inventory History | 171540940 |
| Pallet Records | 1653474547 |
| Shipping Records | 1428628940 |
| Staged Records | 962295313 |
| BOM Final | 1818327795 |
| FP Reference | 944406361 |
| Customer Reference | 336333220 |
| Quotes | 1279128282 |

### API Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/api/sheets` | Fetches Main Data (orders) |
| `/api/inventory` | Merges Fusion Export + Prod Totals |
| `/api/inventory-history` | Inventory History with date range |
| `/api/bom` | BOM Final data |
| `/api/generic-sheet?gid=...` | Fetches any sheet by GID |

### Tech Stack
- Next.js 16.1.6 (App Router)
- React 19.2.3
- Tailwind CSS 4
- shadcn/ui components
- Recharts (for Inventory History charts)
- next-themes (dark/light mode)

---

## 📁 KEY FILES

| File | Purpose |
|------|---------|
| `PROGRESS.md` | Detailed progress tracker |
| `lib/google-sheets.ts` | Google Sheets connection |
| `components/data-table/` | DataTable component system |
| `components/OrderDetail.tsx` | Expandable order detail panel |
| `app/(dashboard)/layout.tsx` | Dashboard layout with sidebar |
| `components/layout/Sidebar.tsx` | Navigation sidebar |

---

## 🎯 NEXT STEPS (Optional)

1. **All Data page** — raw view of Main Data sheet
2. **Drawings** — get actual GID from Simon
3. **Auto-refresh** — refresh data every X minutes
4. **Photo gallery** — full image viewing in records pages
5. **Mobile polish** — any UX tweaks for phone

---

## 📝 Reference

**Old dashboard (for comparison):**
`~/clawd/projects/molding/molding_dashboard_production.html`

**This is a single 35K line HTML file** — the new Next.js version replicates its functionality in a modern, maintainable codebase.
