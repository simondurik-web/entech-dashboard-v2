# Entech Dashboard V2 — Handoff Document

**Last Updated:** 2026-02-07 19:55 EST
**Status:** Phase 3 Complete (Auto-refresh + Photo Lightbox)

---

## 🚀 RESUME PROMPT

Copy and paste this to Marco after restart:

```
Resume the Entech Dashboard V2 project. Read:
- ~/clawd/projects/entech-dashboard-v2/HANDOFF.md
- ~/clawd/projects/entech-dashboard-v2/PROGRESS.md

Current status: Phase 3 complete. All 16 pages built with auto-refresh and photo lightbox.

Live: https://entech-dashboard-v2.vercel.app
Dev: cd ~/clawd/projects/entech-dashboard-v2 && npm run dev (port 3000)
```

---

## 📋 PROJECT STATUS

**Completed:**
- ✅ Phase 1: Foundation (scaffold, Google Sheets, basic pages)
- ✅ Phase 2: Feature Parity (all 16 pages from old dashboard)
- ✅ Phase 3: Auto-refresh (5 min) + Photo Lightbox

**Optional Next Steps:**
- Phil Assistant (AI chat for quick lookups)
- Reports Dashboard (KPIs, daily summary charts)
- Push notifications for overdue orders
- User authentication / role-based access

---

## 📄 ALL PAGES (16 Total)

| Page | Route | Data Source | Features |
|------|-------|-------------|----------|
| Orders | `/orders` | Main Data (GID 290032634) | DataTable, expandable rows, status filters, auto-refresh |
| Staged | `/staged` | Main Data (filtered) | Orders with status "Staged" |
| Shipped | `/shipped` | Main Data (filtered) | Orders with status "Shipped" |
| Inventory | `/inventory` | Fusion Export + Prod Totals | Stock levels, progress bars |
| Need to Make | `/need-to-make` | Main Data (filtered) | Production queue |
| Need to Package | `/need-to-package` | Main Data (filtered) | Packaging queue |
| Inventory History | `/inventory-history` | Inventory History (GID 171540940) | Date picker, multi-part charts |
| Pallet Records | `/pallet-records` | Pallet Pictures (GID 1879462508) | Photo lightbox, auto-refresh |
| Shipping Records | `/shipping-records` | Shipping Records (GID 1752263458) | Photo lightbox, auto-refresh |
| Staged Records | `/staged-records` | Staged Records (GID 1519623398) | Photo lightbox, auto-refresh |
| BOM Explorer | `/bom` | BOM Final (GID 74377031) | Tabs for Individual/Sub/Final |
| Drawings Library | `/drawings` | Production Data Totals | Drawing URLs from sheet |
| FP Reference | `/fp-reference` | FP Reference (GID 944406361) | Reference data |
| Customer Reference | `/customer-reference` | Customer Ref (GID 336333220) | Customer info |
| Quotes Registry | `/quotes` | Quotes (GID 1279128282) | Quote tracking |
| All Data | `/all-data` | Main Data (raw) | Full sheet view, all columns |

---

## 🔧 TECHNICAL DETAILS

### Project Location
```
~/clawd/projects/entech-dashboard-v2/
```

### Commands
```bash
# Start dev server
cd ~/clawd/projects/entech-dashboard-v2
npm run dev

# Build for production
npm run build

# Deploy (auto on push)
git add -A && git commit -m "message" && git push
```

### URLs
- **Live:** https://entech-dashboard-v2.vercel.app
- **Vercel Dashboard:** https://vercel.com/simons-projects-849cf04c/entech-dashboard-v2
- **GitHub:** https://github.com/simondurik-web/entech-dashboard-v2

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
| Pallet Pictures | 1879462508 |
| Shipping Records | 1752263458 |
| Staged Records | 1519623398 |
| BOM Final | 74377031 |
| BOM Sub | 206288913 |
| BOM Individual | 751106736 |
| FP Reference | 944406361 |
| Customer Reference | 336333220 |
| Quotes | 1279128282 |

### Tech Stack
- **Framework:** Next.js 16.1.6 (App Router)
- **React:** 19.2.3
- **Styling:** Tailwind CSS 4 + shadcn/ui
- **Charts:** Recharts
- **Theme:** next-themes (dark/light)
- **Hosting:** Vercel (Hobby tier)

---

## 📁 KEY FILES & COMPONENTS

### Core Components
| File | Purpose |
|------|---------|
| `components/data-table/DataTable.tsx` | Reusable table with sorting, filtering, column visibility, CSV export |
| `components/data-table/ColumnFilter.tsx` | Multi-select column filter |
| `components/data-table/ColumnToggle.tsx` | Show/hide columns |
| `components/data-table/ExportCSV.tsx` | CSV export button |
| `components/OrderDetail.tsx` | Expandable order details (pallets, photos, shipping) |
| `components/ui/Lightbox.tsx` | Full-screen photo viewer with keyboard nav |
| `components/ui/PhotoGrid.tsx` | Photo thumbnails that open lightbox |
| `components/ui/AutoRefreshControl.tsx` | Auto-refresh toggle with countdown |
| `components/layout/Sidebar.tsx` | Navigation sidebar |
| `components/layout/LanguageToggle.tsx` | EN/ES language switcher |

### Hooks & Utils
| File | Purpose |
|------|---------|
| `lib/use-data-table.ts` | Hook for sorting, filtering, searching |
| `lib/use-auto-refresh.ts` | Hook for auto-refresh with interval |
| `lib/google-sheets.ts` | Google Sheets data fetching + parsing |
| `lib/export-csv.ts` | CSV export utility |

### API Routes
| Endpoint | Purpose |
|----------|---------|
| `/api/sheets` | Fetches Main Data (orders) |
| `/api/inventory` | Merges Fusion Export + Prod Totals |
| `/api/inventory-history` | Inventory History with date range |
| `/api/bom` | BOM Final data |
| `/api/pallet-records` | Pallet Pictures records |
| `/api/shipping-records` | Shipping records |
| `/api/staged-records` | Staged records |
| `/api/all-data` | Raw Main Data (all columns) |
| `/api/generic-sheet?gid=...` | Fetches any sheet by GID |

---

## 🎨 FEATURES IMPLEMENTED

### DataTable System
- Click column headers to sort (asc/desc)
- Multi-select filters per column
- Global search across all columns
- Toggle column visibility
- Export to CSV
- Mobile card view with same data

### Expandable Order Rows
- Click any order row to expand
- Shows pallet details (weight, dimensions, photos)
- Shows shipping info for shipped orders
- Smooth 300ms animation

### Auto-Refresh
- 5-minute interval (configurable in code)
- Toggle on/off per page
- Live countdown timer
- Manual refresh button always available

### Photo Lightbox
- Click thumbnail → full-screen overlay
- Keyboard navigation (← → Esc)
- Thumbnail strip for multi-photo
- Download & open-in-new-tab buttons
- Works with Google Drive URLs

### i18n (Language Toggle)
- EN/ES toggle in sidebar
- Stored in localStorage

### Theme
- Dark/Light mode toggle
- Persisted in localStorage
- System preference detection

---

## 📝 RECENT CHANGES (2026-02-07)

1. **All Data page** — raw view of Main Data sheet
2. **Auto-refresh** — 5 min interval with countdown
3. **Photo Lightbox** — full-screen viewer with navigation
4. **PhotoGrid component** — replaces old ImageModal

---

## 🔗 REFERENCE

**Old dashboard (for comparison):**
`~/clawd/projects/molding/molding_dashboard_production.html`

This is a single 35K line HTML file — the new Next.js version replicates its functionality in a modern, maintainable codebase.

---

## ⚠️ KNOWN ISSUES / NOTES

1. **Drawings page** — currently pulls from Production Data Totals (columns G & H). May need separate GID if there's a dedicated Drawings sheet.

2. **Google Drive photos** — Lightbox handles `drive.google.com/open?id=...` URLs by converting to `drive.google.com/uc?export=view&id=...`

3. **BOM Explorer** — Currently shows BOM Final. Has tabs for Individual/Sub/Final but may need API refinement for sub-assemblies.

---

*Ready for context reset. All code is committed and pushed to GitHub.*
