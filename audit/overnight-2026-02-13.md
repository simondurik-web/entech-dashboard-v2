# Overnight Parity Work — 2026-02-13

**Started:** 12:30 AM EST
**Goal:** Match V1 molding dashboard features in V2 (Next.js)
**Base commit:** f098800
**Base tag:** before-overnight-parity-20260213

---

## Phase Log

### Phase 1: Zoom Controls
**Time:** 00:31 AM EST
**Files changed:**
- `components/layout/ZoomControls.tsx` — **NEW** — Zoom +/-, reset buttons with localStorage persistence (key: `dashboard-zoom`), range 0.5–2.0x, hidden on mobile
- `components/layout/Sidebar.tsx` — Added `<ZoomControls />` between toggle controls and nav
- `app/(dashboard)/layout.tsx` — Reads zoom from localStorage, listens for `zoom-changed` custom event, applies `zoom` CSS to `<main>`
**Build:** ✅ Passes


## Password Protection for Sales Pages

**Added:** `components/SalesPasswordGate.tsx`
- Client component wrapping sales page content
- Checks `sessionStorage('salesUnlocked')` on mount
- Modal overlay with lock icon, password input, submit button (shadcn Card/Input/Button)
- Hash validation: `hashCode(password) === 2001594324` (password: `Sales@@@`)
- Shake animation on wrong password, error message
- Once unlocked, persists for session via sessionStorage

**Modified:**
- `app/(dashboard)/sales-overview/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/(dashboard)/sales-parts/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/(dashboard)/sales-customers/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/(dashboard)/sales-dates/page.tsx` — wrapped with `<SalesPasswordGate>`
- `app/globals.css` — added shake keyframe animation

**Build:** ✅ Passes

## Material Requirements Page

### Added Files:
- `app/api/material-requirements/route.ts` — API route that computes material requirements by:
  - Fetching open orders, BOM Sub-Assembly data, and inventory in parallel
  - Extracting hub/tire demand from pending orders
  - Looking up BOM sub-assembly components to calculate raw material needs (lbs)
  - Comparing against inventory for surplus/shortage/coverage status
  - Returns summary stats, material table, hub breakdown, and tire breakdown

- `app/(dashboard)/material-requirements/page.tsx` — Full page with:
  - Summary cards (open orders, hubs needed, tires needed, shortages, urethane, crumb rubber)
  - Search bar for filtering materials
  - Category filter chips (All / Roll Tech / Molding / Snap Pad)
  - Material cards with on-hand, needed, surplus/shortage, coverage bar, status badge
  - Expandable demand breakdown per material (grouped by component)
  - Hub Production Breakdown table
  - Tire Production Breakdown table
  - CSV export
  - Refresh button

### Modified Files:
- `components/layout/Sidebar.tsx` — Added "Material Requirements" nav item after BOM Explorer (with Package icon, as sub-item)

### Build: ✅ Passes

---

## Phase 2: Inventory Forecast Columns + Manufactured/Purchased/COM Filters

### Changes:

#### `lib/google-sheets.ts`
- Added `makeOrBuy: 13` to `PROD_COLS` (column N — Make/Purchased/Com)
- Extended `InventoryItem` interface with: `itemType`, `projectionRate`, `usage7`, `usage30`, `daysToMin`, `daysToZero`, `isManufactured`
- Added `normalizeItemType()` helper to map raw sheet values to "Manufactured" / "Purchased" / "COM"
- Updated `fetchInventory()` to:
  - Fetch inventory history in parallel for usage computation
  - Compute 7-day and 30-day usage from historical stock snapshots
  - Calculate daily projection rate, days to min, days to zero
  - Read item type from Production Data Totals column N

#### `app/(dashboard)/inventory/page.tsx`
- Added type filter buttons (🏭 Manufactured, 🛒 Purchased, 📦 COM) — toggle-able, multi-select
- Each card now shows:
  - Item type badge with emoji and color coding
  - Daily usage rate (or "Prod Rate" for manufactured items) with trend indicator
  - Days to Min (or "Days to Target" for manufactured) with color coding (red <7d, yellow <30d, green >30d)
  - Days to Zero (non-manufactured items only)
- Trend indicator compares 7-day vs 30-day usage (normalized):
  - Manufactured: ↑ Faster (green) / ↓ Slower (red) / → Stable
  - Non-manufactured: ↑ Up (red) / ↓ Down (green) / → Stable

### Build: ⚠️ Pre-existing error in orders/page.tsx (Cannot find name 'OrderCard') — not from these changes. Inventory page compiles cleanly.

---

## Phase 2: Order Drilldown Photo Grid Enhancement

### Changes Made

#### `components/OrderDetail.tsx` — Full rewrite
- Added **4-column photo drilldown grid** matching V1 layout (responsive: 1→2→4 cols)
- **Box 1 — Pallet Details (Blue):** Shows pallet photos with PhotoGrid component + weight/dimensions info
- **Box 2 — Fusion Pictures (Teal):** Shows fusion photos from staged records
- **Box 3 — Shipment & Paperwork (Green):** Shows shipment + paperwork photos separately
- **Box 4 — Close-Up Pictures (Purple):** Shows close-up photos from shipping records
- Each box has colored background with top border accent (matching V1 style)
- Drawings section preserved with lightbox support
- Shipping details section for shipped orders
- Pallet records detail section with per-pallet breakdown
- Now fetches staged records API for fusion photos

#### `lib/google-sheets.ts` — Data layer enhancements
- `ShippingRecord` interface: Added `shipmentPhotos`, `paperworkPhotos`, `closeUpPhotos` fields
- `StagedRecord` interface: Added `fusionPhotos` field
- `fetchShippingRecords()`: Parses "Shipment Pictures", "Paperwork Pictures", "Close Up Pictures" columns
- `fetchStagedRecords()`: Parses "Fusion Pictures" column
- All new columns match V1 Google Sheets column names for compatibility

#### `app/(dashboard)/orders/page.tsx` — Bug fix
- Added missing `import { OrderCard }` (pre-existing build error)

#### `app/(dashboard)/shipped/page.tsx` — Bug fix
- Added missing `import { OrderDetail }` (pre-existing build error)

### Pages with drilldown support (all use OrderDetail component):
- ✅ Orders page — has expandable rows + mobile OrderCard with OrderDetail
- ✅ Shipped page — has expandable rows + mobile OrderCard with OrderDetail
- ✅ Staged page — has OrderDetail in drilldown
- Need to Make / Need to Package — no drilldown (different data model, not order-based)

### Build: ✅ Passes cleanly

## Mobile Card Components with Category Color Coding

### New Components Created:
- **`components/cards/OrderCard.tsx`** — Reusable mobile order card with:
  - Category-based left border + background tint (Roll Tech=blue, Molding=yellow, Snap Pad=purple)
  - Category badge, priority badge (URGENT/P1-P5), status badge with color coding
  - Days Until Due coloring (red if negative, orange if <3)
  - 3-column grid: Qty, Priority, Due, IF#, PO#, Line
  - Click-to-expand with OrderDetail drilldown
  - Props: `statusOverride`, `showShipDate`, `extraFields` for page-specific customization

- **`components/cards/InventoryCard.tsx`** — Reusable mobile inventory card with:
  - Stock status left border (green=OK, yellow=LOW, red=CRITICAL)
  - Part number + product name, status badge
  - In Stock / Minimum / Target grid
  - Progress bar showing % of minimum

### Pages Updated to Use Reusable Cards:
- `orders/page.tsx` — Uses OrderCard (replaces 50+ line inline card)
- `staged/page.tsx` — Uses OrderCard with `statusOverride="Staged"` (replaces inline Card)
- `need-to-package/page.tsx` — Uses OrderCard with stock `extraFields`
- `shipped/page.tsx` — Uses OrderCard with `showShipDate` + `statusOverride="Shipped"`
- `inventory/page.tsx` — Uses InventoryCard (replaces inline Card, removed unused `statusStyle`)

### Build: ✅ Passes

---

## Phase 3: Pallet Load Calculator

### New Files
- `components/PalletLoadCalculator.tsx` — Full pallet load calculator component (self-contained, ~400 lines)

### Modified Files
- `app/(dashboard)/staged/page.tsx` — Added collapsible PLC section below orders table

### Features Implemented
1. **Trailer selection** — 53' / 48' toggle buttons
2. **Max payload weight** — Configurable (default 45,000 lbs)
3. **Pallet types** — Add/remove with label, color, width/length/qty/weight, orientation (auto/widthwise/lengthwise), double-stack toggle
4. **Color-coded pallets** — 8 colors with click-to-cycle color picker
5. **Drag-to-reorder** — HTML drag and drop API for loading order
6. **SVG trailer diagram** — Top-down view with scaled pallets, dimension arrows, DOOR/FRONT labels, overflow indicator
7. **Stats panel** — Total pallets, total weight (with progress bar), space used %, load status (OK/OVERWEIGHT/WON'T FIT)
8. **Weight progress bar** — Green/amber/red color coding
9. **Link Orders feature** — Toggle per pallet type to link staged orders, searchable checkbox list, auto-fill from order data, cross-pallet conflict detection
10. **Bilingual** — Full EN/ES translations
11. **Packing algorithm** — Greedy row-based placement matching V1 behavior

### Build: ✅ Passes

---

## Verification Fixes (Post-Audit)

### 1. Staged page title: "Staged Orders" → "Ready to Ship"
- Matches V1 and sidebar label

### 2. Staged page: Added table view with DataTable
- Integrated DataTable component with column toggle, CSV export, search
- Card view preserved via renderCard prop (same as Orders page pattern)
- Columns: Line, IF#, PO#, Priority, Days Until, Customer, Part#, Qty, Tire, Hub, Bearings

### 3. Material Requirements search: ✅ Already present
- Confirmed existing `<Input>` search box filters by material name

### 4. Orders column reorder to match V1
- New order: Line, IF#, PO#, Priority, Days Until, Customer, Part#, Qty, Tire, Hub, Bearings, Status, Category, Assigned
- Category and Assigned moved to end (hidden by default via column toggle)

### Build: ✅ Passes
