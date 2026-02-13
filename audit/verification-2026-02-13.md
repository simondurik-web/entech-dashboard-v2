# Verification Plan — 2026-02-13

**V1:** https://simondurik-web.github.io/Molding-test-dashboard/
**V2:** http://localhost:3000

---

## Checklist

### Production Pages
- [ ] Orders Data — columns, filters, sorting, drilldown, mobile cards
- [ ] Need to Make — columns, filters, mobile cards
- [ ] Need to Package — columns, filters, mobile cards
- [ ] Ready to Ship (Staged) — columns, filters, mobile cards, pallet calculator
- [ ] Shipped — columns, filters, mobile cards

### Inventory
- [ ] Inventory — cards, filters (All/Low/Needs Prod/Manufactured/Purchased/COM), forecast data
- [ ] Inventory History — chart, date picker, part selection

### Records
- [ ] Pallet Records — columns, photo lightbox
- [ ] Shipping Records — columns
- [ ] Staged Records — columns

### Reference/Data
- [ ] BOM Explorer — tabs (Final/Sub/Individual)
- [ ] FP Reference — columns, filters
- [ ] Customer Reference — columns, filters
- [ ] Quotes Registry — columns, filters
- [ ] All Data — columns

### Sales (Password Protected)
- [ ] Password gate works (Sales@@@)
- [ ] P/L Overview — charts, summary cards
- [ ] By Part Number — table, filters
- [ ] By Customer — table, filters
- [ ] By Date — table, filters

### New Features
- [ ] Material Requirements — page renders, data correct
- [ ] Zoom Controls — +/-/reset works
- [ ] Pallet Load Calculator — trailer selection, pallet types, SVG diagram, link orders
- [ ] Mobile card view — category colors, priority badges

### Cross-Cutting
- [ ] Dark/Light theme toggle
- [ ] EN/ES language toggle
- [ ] Sidebar navigation (all links work)
- [ ] Auto-refresh controls

## Issues Found

### Page: Orders (/orders)
- ✅ Page title matches: "📋 Orders Data" with subtitle "Complete order database with all statuses"
- ✅ Summary stats present: Total Orders (62), Need to Make (30), Making (5), Ready to Ship (27)
- ✅ Category filters: All, 🔵 Roll Tech, 🟡 Molding, 🟣 Snap Pad
- ✅ Status filters: Need to Make, Making, Ready to Ship, Shipped
- ✅ Search textbox present
- ✅ Columns toggle button present
- ✅ Export button present (CSV)
- ✅ Row click expand works (onRowClick implemented in source)
- ✅ OrderCard component used for mobile rendering
- ✅ Auto-refresh controls present (Auto 4m 56s + Refresh now)
- ❌ **Column order differs from V1:** V2 shows Line, Customer, Part#, Category, Qty, Priority, Days Until, IF#, PO#, Status, Tire, Hub, Bearings, Assigned. V1 shows Line, IF#, PO#, Priority, Days Until, Customer, Part#, Qty, Tire, Hub, Bearings, Status
- ❌ **Extra columns in V2 not in V1:** "Category" and "Assigned" columns are new in V2
- ❌ **Status values differ:** V2 uses "Pending" (V1: "Need to Make"), "Work in Progress" (V1: "Making"), "Staged" (V1: "Ready to Ship"). Status filter buttons still say "Need to Make"/"Making"/"Ready to Ship" but the cell values are different
- ❌ **Priority mapping differs:** V1 shows P3/P4 priorities; V2 maps many P3/P4 orders to "URGENT" instead

### Page: Need to Make (/need-to-make)
- ❌ **Completely different page concept:** V1's "Need to Make" was a filtered view of orders with status "Need to Make". V2's "Need to Make" shows inventory-based production needs (parts to manufacture based on inventory vs minimums)
- ❌ **Different columns:** V2 has Product, Part#, Mold Type, Fusion Inv, Minimums, Parts to Make. V1 had the same order columns (Line, IF#, PO#, etc.)
- ❌ **Different filters:** V2 uses All/Tires/Hubs/Finished Parts/Bearings instead of Roll Tech/Molding/Snap Pad
- ✅ Search textbox present
- ✅ Columns toggle button present
- ✅ Export button present
- 🟡 Only 2 items showing (may be data issue — "Molding feedstock" entries only)

### Page: Need to Package (/need-to-package)
- ✅ This is a **new page** not present in V1 (V1 had no "Need to Package" concept)
- ✅ Page title: "📦 Need to Package" with subtitle "Orders ready to be packaged based on inventory"
- ✅ Summary stats: Total Orders (35), Ready to Package (0), Missing Stock (35), Urgent & Ready (0)
- ✅ Category filters: All, 🔵 Roll Tech, 🟡 Molding, 🟣 Snap Pad
- ✅ Search textbox present
- ✅ Columns toggle button present
- ✅ Export button present
- ✅ OrderCard component used for mobile rendering

### Page: Staged / Ready to Ship (/staged)
- ✅ Page title: "Staged Orders" (V1 called it "Ready to Ship")
- ✅ Category filters: All, 🔵 Roll Tech, 🟡 Molding, 🟣 Snap Pad
- ✅ Search textbox present ("Search staged orders...")
- ✅ Refresh button present
- ✅ OrderCard component used (card-based layout, not table)
- ✅ 27 staged orders displayed with correct data
- ✅ **Pallet Load Calculator toggle visible** at bottom: "📦 Pallet Load Calculator ▼"
- ✅ **Pallet Calculator opens on click** — shows trailer sizes (53'/48'), pallet types, "+ Add Pallet Type" button
- ❌ **No Columns toggle button** (uses card layout only, no table view)
- ❌ **No Export/CSV button** (V1's "Ready to Ship" had export via the orders table)
- ❌ **Title mismatch:** V2 says "Staged Orders", V1 said "Ready to Ship" in sidebar (V2 sidebar also says "Ready to Ship" but page title says "Staged Orders")
- 🟡 **Card layout only** — V1 used the same table format as Orders; V2 uses cards exclusively for this page

### Page: Shipped (/shipped)
- ✅ Page title: "🚚 Shipped" with subtitle "Completed shipments"
- ✅ Summary stats: Total Shipments (69), Total Units (102,766)
- ✅ Time range filters: All Time, Last 7 Days, Last 30 Days, Last 90 Days (new in V2)
- ✅ Category filters: All, 🔵 Roll Tech, 🟡 Molding, 🟣 Snap Pad
- ✅ Search textbox present
- ✅ Columns toggle button present
- ✅ Export button present
- ✅ Row click expand works (onRowClick implemented)
- ✅ OrderCard component used for mobile rendering
- ✅ Refresh button present

### Cross-Page Summary

| Issue | Severity | Details |
|-------|----------|---------|
| Status value mismatch | 🔴 High | V2 uses Pending/Work in Progress/Staged instead of V1's Need to Make/Making/Ready to Ship |
| Need to Make page redesigned | 🟡 Medium | Completely different concept — inventory-based instead of order-status-based |
| Orders column order changed | 🟡 Medium | Columns reordered; Category and Assigned columns added |
| Staged page missing table view | 🟡 Medium | Card-only layout, no Columns toggle or Export button |
| Staged title mismatch | 🟢 Low | Sidebar says "Ready to Ship" but page says "Staged Orders" |
| Priority mapping differs | 🟡 Medium | P3/P4 mapped to URGENT in V2 for some orders |


---

## Agent: verify-inventory-sales-features (00:46 EST)

### 1. Inventory Page (/inventory) ✅
- **Page renders:** Yes, loads correctly
- **Summary cards:** Total Items (2), Needs Production (0), Low Stock (0), Adequate Stock (2) — all present
- **Search box:** Present ("Search by part number...")
- **Filter buttons found:** All ✅, ⚠️ Low Stock ✅, 🔧 Needs Production ✅
- **Filter buttons MISSING:** 🏭 Manufactured ❌, 🛒 Purchased ❌, 📦 COM ❌
  - Only 3 filter buttons exist (All, Low Stock, Needs Production) instead of 6
- **Inventory cards show:**
  - Part number ✅ (e.g., FS-URTH-CLR-PLVL)
  - Product description ✅ ("Molding feedstock")
  - Stock level ✅ (In Stock, Minimum, Target values)
  - Progress bar ✅ (e.g., "207% of minimum")
  - Status badge ✅ ("OK")
- **Forecast fields MISSING:**
  - Item type badge ❌ (no Manufactured/Purchased/COM badge visible)
  - Daily usage ❌
  - Trend indicator ❌
  - Days to min ❌
  - Days to zero ❌
  - **Note:** Only 2 items in inventory — may be a data issue, but the card layout doesn't include forecast fields

### 2. Material Requirements (/material-requirements) ✅
- **Page renders:** Yes, fully functional
- **Summary cards:** Open Orders (35), Hubs Needed (101,478), Tires Needed (101,478), Shortages (6), Urethane Needed (10,710 lbs), Crumb Rubber (346,275 lbs) — all present ✅
- **Material list:** 8 materials displayed with On Hand, Needed, Surplus/Shortage, Coverage % ✅
- **Category filters:** All, Roll Tech, Molding, Snap Pad ✅
- **Search filter:** Not visible (no search textbox found) ❌
- **Hub Production Breakdown table:** Present with 13 rows ✅
- **Tire Production Breakdown table:** Present with 9 rows ✅
- **Status badges:** SHORTAGE and OK badges present ✅

### 3. Sales Overview (/sales-overview) ✅
- **Password gate appears:** Yes ✅
- **Modal text:** "Sales Access — Enter password to view sales data — Unlock" ✅
- **Lock icon:** Text says "Sales Access" (icon not confirmed via text snapshot, but modal structure present)
- **Password input:** Implied by "Enter password" prompt (field exists but not explicitly labeled in text dump)
- **Does NOT bypass:** Sales data is not visible without password ✅

### 4. Zoom Controls ✅
- **Zoom label:** "Zoom" text present ✅
- **Zoom out button:** Present ✅
- **Zoom percentage display:** "100%" shown ✅
- **Zoom in button:** Present ✅
- **Reset zoom button:** Present ✅

### 5. Theme & Language Toggle ✅
- **Dark/Light toggle:** "Toggle theme" button with "Dark" label present ✅
- **EN/ES language toggle:** EN button, "/" separator, ES button present ✅

### 6. Sidebar Navigation ✅
**Production section:**
- Orders Data ✅ (/orders)
- Need to Make ✅ (/need-to-make)
- Need to Package ✅ (/need-to-package)
- Ready to Ship ✅ (/staged)
- Shipped ✅ (/shipped)
- Inventory ✅ (/inventory)
- Inventory History ✅ (/inventory-history)
- Drawings ✅ (/drawings)
- Pallet Records ✅ (/pallet-records)
- Shipping Records ✅ (/shipping-records)
- Staged Records ✅ (/staged-records)
- BOM Explorer ✅ (/bom)
- Material Requirements ✅ (/material-requirements)
- FP Reference ✅ (/fp-reference)
- Customer Reference ✅ (/customer-reference)
- Quotes Registry ✅ (/quotes)

**Sales & Finance section:**
- P/L Overview ✅ (/sales-overview)
- By Part Number ✅ (/sales-parts)
- By Customer ✅ (/sales-customers)
- By Date ✅ (/sales-dates)

**Raw Data section:**
- All Data ✅ (/all-data)

**Extra items:**
- Phil Assistant button ✅ (bonus feature)

**All 21 navigation items present and accounted for.** ✅

### Issues Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | 🟡 Medium | Inventory filter buttons missing: 🏭 Manufactured, 🛒 Purchased, 📦 COM (only All, Low Stock, Needs Production exist) |
| 2 | 🟡 Medium | Inventory forecast fields missing: item type badge, daily usage, trend indicator, days to min, days to zero |
| 3 | 🟢 Low | Material Requirements page lacks a search/filter textbox (only category tabs) |
| 4 | 🟢 Low | Only 2 inventory items loaded — may be data limitation rather than UI bug |
