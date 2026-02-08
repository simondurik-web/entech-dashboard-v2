# 🌙 Overnight Dashboard Audit Task

**Created:** 2026-02-07 20:15 EST
**Objective:** Compare Entech Dashboard V2 with working RT-dashboard, document all differences, and fix functionality gaps

---

## 📋 DASHBOARDS TO COMPARE

| Dashboard | Type | URL | Source |
|-----------|------|-----|--------|
| **RT-dashboard** | Working Reference ✅ | https://simondurik-web.github.io/RT-dashboard/ | `~/clawd/projects/molding/molding_dashboard_production.html` |
| **Entech V2** | Under Verification 🔍 | https://entech-dashboard-v2.vercel.app | `~/clawd/projects/entech-dashboard-v2/` |

---

## 🎯 TASK OVERVIEW

### Phase 1: Code Analysis (Read-Only)
Compare source code structure, identify missing features

### Phase 2: Visual Verification (Browser)
Open both dashboards, screenshot each page, compare layouts

### Phase 3: Functional Testing (Browser + Interaction)
Click through every interactive element, verify behavior matches

### Phase 4: Documentation
Create detailed log of all differences with severity ratings

### Phase 5: Implementation
Fix all identified issues to achieve feature parity

---

## 📊 SECTION-BY-SECTION COMPARISON CHECKLIST

### 1. ORDERS DATA PAGE

**RT-Dashboard Features to Verify in V2:**
- [ ] Column headers with sort arrows (click to sort asc/desc/clear)
- [ ] Filter dropdown on each column (funnel icon)
  - [ ] Search box within filter dropdown
  - [ ] Select All / Deselect All buttons
  - [ ] Checkbox for each unique value
  - [ ] Apply / Clear buttons
  - [ ] "Hide Column" button in filter dropdown
- [ ] Column toggle (⚙️ Columns button)
  - [ ] Checkboxes to show/hide each column
  - [ ] "Show Hidden" counter badge
- [ ] Category filter chips (Roll Tech / Molding / Snap Pad / All)
- [ ] Status filter chips (Need to Make / Making / Ready to Ship / Shipped)
- [ ] Global search bar
- [ ] Row count display ("X orders")
- [ ] CSV Export button
- [ ] Expandable row drilldown (click row to expand)
  - [ ] 4-box photo grid (Pallet Details, Fusion Pics, Shipment, Close-Up)
  - [ ] Photo lightbox (click to enlarge)
  - [ ] Keyboard navigation in lightbox (← → Esc)
- [ ] Status badges with correct colors
- [ ] Urgency highlighting (red border for overdue)
- [ ] Days until due display with color coding

**Columns to Verify:**
| Column | Sortable | Filterable | RT Status | V2 Status |
|--------|----------|------------|-----------|-----------|
| Line | ✅ | ❌ | | |
| Priority | ✅ | ✅ | | |
| Days Until | ✅ | ❌ | | |
| Request Date | ✅ | ❌ | | |
| Customer | ✅ | ✅ | | |
| Category | ✅ | ✅ | | |
| IF # | ✅ | ❌ | | |
| PO # | ✅ | ❌ | | |
| Part # | ✅ | ✅ | | |
| Qty | ✅ | ❌ | | |
| Packaging | ✅ | ✅ | | |
| Tire | ✅ | ✅ | | |
| Hub | ✅ | ✅ | | |
| Hub Mold | ✅ | ✅ | | |
| Bearings | ✅ | ✅ | | |
| Status | ✅ | ✅ | | |
| Assigned | ✅ | ✅ | | |

---

### 2. NEED TO MAKE PAGE (Production Queue)

**RT-Dashboard Features:**
- [ ] Shows orders with status = pending/approved
- [ ] Same column filter system as Orders
- [ ] Category/Status chips
- [ ] Row expansion for WIP orders shows pallet details
- [ ] Missing parts indicator

---

### 3. READY TO SHIP (Staged) PAGE

**RT-Dashboard Features:**
- [ ] Shows orders with status = staged
- [ ] Same column/filter system
- [ ] Expandable rows with 4-box photo grid
- [ ] Staged date column

---

### 4. SHIPPED PAGE

**RT-Dashboard Features:**
- [ ] Shows orders with status = shipped
- [ ] Shipped Date column
- [ ] Revenue / P/L columns (password protected)
- [ ] Same filter system

---

### 5. INVENTORY PAGE

**RT-Dashboard Features:**
- [ ] Merged data from Fusion Export + Production Totals
- [ ] Columns: Part #, Product, Fusion Qty, Minimum, Target, Status
- [ ] Low Stock badge (red) when < minimum
- [ ] Needs Production badge (yellow)
- [ ] Progress bar showing stock level vs target
- [ ] Category filter (Tire / Hub / All)
- [ ] Click to view history inline modal

---

### 6. INVENTORY HISTORY PAGE

**RT-Dashboard Features:**
- [ ] Date range picker (From / To)
- [ ] Multi-part selection (up to 10 parts)
- [ ] Line chart with multiple series
- [ ] Legend with part names
- [ ] Preset buttons (Last 7 Days, Last 30, Last 90, All)

---

### 7. PALLET RECORDS PAGE

**RT-Dashboard Features:**
- [ ] Shows all pallet picture records
- [ ] Photo thumbnails that open lightbox
- [ ] Columns: Timestamp, Order #, Pallet #, Customer, Category, Weight, Dimensions
- [ ] Category filter

---

### 8. SHIPPING RECORDS PAGE

**RT-Dashboard Features:**
- [ ] Shows all shipping photo records
- [ ] Photo lightbox
- [ ] Category filter
- [ ] IF # linkage

---

### 9. STAGED RECORDS PAGE

**RT-Dashboard Features:**
- [ ] Shows staging confirmation records
- [ ] Photo lightbox
- [ ] Line #, IF #, Status columns

---

### 10. BOM EXPLORER PAGE

**RT-Dashboard Features:**
- [ ] Three tabs: Final Assembly / Sub Assembly / Individual Items
- [ ] Part search
- [ ] Component tree view
- [ ] Quantity multipliers

---

### 11. DRAWINGS LIBRARY PAGE

**RT-Dashboard Features:**
- [ ] Grid/list of drawing thumbnails
- [ ] Part # search
- [ ] Category filter
- [ ] Click to open drawing (PDF/image)

---

### 12. REFERENCE DATA PAGES (FP Ref, Customer Ref, Quotes)

**RT-Dashboard Features:**
- [ ] Password protection (Sales@@@)
- [ ] Dynamic columns from sheet
- [ ] Full filter system
- [ ] Export CSV

---

### 13. ALL DATA PAGE

**RT-Dashboard Features:**
- [ ] Password protection
- [ ] All columns A-AX from Main Data sheet
- [ ] Dynamic column headers
- [ ] Filter system
- [ ] Horizontal scroll

---

### 14. GLOBAL UI FEATURES

**RT-Dashboard Features:**
- [ ] Sidebar navigation with icons
- [ ] Language toggle (EN/ES)
- [ ] Theme toggle (Dark/Light)
- [ ] Zoom control
- [ ] Phil Assistant (AI chat)
- [ ] Mobile card view (portrait mode)
- [ ] Responsive breakpoints

---

## 🔧 KNOWN V2 ISSUES TO FIX

Based on initial code review:

1. **Column Filter Dropdown**
   - V2 has basic filter but missing "Hide Column" button
   - V2 filter uses Popover, RT uses custom dropdown with better styling

2. **Photo Drilldown**
   - V2 has OrderDetail.tsx but may not match RT's 4-box grid exactly
   - Need to verify Fusion Pics / Shipment / Close-Up boxes

3. **Status Normalization**
   - RT has `getVal()` with column alternatives (Tire/Llanta/Tire (Llanta))
   - V2 may be using hardcoded column names

4. **Missing Features**
   - Phil Assistant (AI chat) - not in V2
   - Zoom control - not in V2
   - Some password protection pages

---

## 📸 BROWSER VERIFICATION WORKFLOW

For each page, the coding agent should:

1. **Open RT-dashboard** → Take screenshot → Save as `audit/screenshots/rt-{page}.png`
2. **Open V2** → Take screenshot → Save as `audit/screenshots/v2-{page}.png`
3. **Document differences** in `audit/comparison-log.md`
4. **Test interactions:**
   - Click each column header (verify sort)
   - Click filter icon (verify dropdown)
   - Click row (verify expansion)
   - Click photo (verify lightbox)
5. **Log results** with severity:
   - 🔴 CRITICAL: Feature broken/missing
   - 🟡 WARNING: Works but different behavior
   - 🟢 OK: Matches reference

---

## 🛠️ IMPLEMENTATION PRIORITY

After audit, fix issues in this order:

1. **P0 - CRITICAL** (breaks core functionality)
   - Column filter dropdowns must match RT behavior
   - Row expansion/drilldown must show all photo boxes
   - Sorting must work identically

2. **P1 - HIGH** (missing expected features)
   - Hide column from filter dropdown
   - Status badge colors matching RT
   - Category/Status filter chips

3. **P2 - MEDIUM** (polish)
   - Exact styling match
   - Animation timing
   - Mobile card view details

4. **P3 - LOW** (nice to have)
   - Phil Assistant
   - Zoom control

---

## 📁 OUTPUT FILES

The overnight task should produce:

```
~/clawd/projects/entech-dashboard-v2/audit/
├── screenshots/
│   ├── rt-orders.png
│   ├── v2-orders.png
│   ├── rt-inventory.png
│   ├── v2-inventory.png
│   └── ... (all pages)
├── comparison-log.md        # Detailed findings
├── differences-summary.md   # Executive summary
└── fix-plan.md              # Prioritized fix list
```

---

## 🚀 EXECUTION INSTRUCTIONS

### For Claude Code / Codex:

```
TASK: Dashboard Feature Parity Audit & Fix

You are auditing Entech Dashboard V2 against the working RT-dashboard.

REFERENCE (working): https://simondurik-web.github.io/RT-dashboard/
TARGET (to fix): https://entech-dashboard-v2.vercel.app

SOURCE CODE:
- RT-dashboard: ~/clawd/projects/molding/molding_dashboard_production.html
- V2: ~/clawd/projects/entech-dashboard-v2/

WORKFLOW:
1. Create ~/clawd/projects/entech-dashboard-v2/audit/ directory
2. For each page listed in OVERNIGHT-AUDIT-TASK.md:
   a. Open RT-dashboard page in browser, take screenshot
   b. Open V2 page in browser, take screenshot
   c. Compare visually and functionally
   d. Log differences in audit/comparison-log.md
3. After completing audit, create audit/fix-plan.md with prioritized fixes
4. Implement P0 and P1 fixes
5. Test fixes by re-comparing pages
6. Commit changes with detailed commit message

CRITICAL FOCUS AREAS:
- Column filter dropdowns (must have hide column, select all/deselect all)
- Row expansion with 4-box photo grid
- Sort arrow behavior
- Status badge colors
- Category/Status filter chips

Use browser tool for screenshots. Use edit tool for code fixes.
Work section by section. Document everything.
```

---

## ⏰ ESTIMATED TIME

| Phase | Estimated Duration |
|-------|-------------------|
| Code Analysis | 30 min |
| Screenshot All Pages | 45 min |
| Functional Testing | 1.5 hours |
| Documentation | 30 min |
| P0 Fixes | 2-3 hours |
| P1 Fixes | 2-3 hours |
| Verification | 30 min |
| **TOTAL** | **7-9 hours** |

---

*Ready for overnight execution. All context is in this file.*
