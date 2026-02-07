# Phase 2: Feature Parity Workflow

**Goal:** Replicate all features from molding_dashboard_production.html in the Next.js v2 app.

---

## 📊 Feature Inventory (from v1)

### Pages to Build (Priority Order)

| Page | Status | Complexity | Assign To |
|------|--------|------------|-----------|
| Orders Data | ✅ Basic | - | Done |
| Staged | ✅ Basic | - | Done |
| Inventory | ✅ Basic | - | Done |
| **Need to Make** | 🔴 Missing | Medium | Codex |
| **Need to Package** | 🔴 Missing | Medium | Codex |
| **Shipped** | 🔴 Missing | Medium | Codex |
| **Inventory History** | 🔴 Missing | High | Claude Code |
| **Drawings Library** | 🔴 Missing | Medium | Codex |
| **Pallet Records** | 🔴 Missing | Medium | Codex |
| **Shipping Records** | 🔴 Missing | Medium | Codex |
| **Staged Records** | 🔴 Missing | Medium | Codex |
| **BOM Explorer** | 🔴 Missing | High | Claude Code |

### Core Features to Add

| Feature | Status | Complexity | Assign To |
|---------|--------|------------|-----------|
| Column Sorting | 🔴 Missing | Medium | Claude Code |
| Column Filtering (multi-select) | 🔴 Missing | High | Claude Code |
| Column Visibility Toggle | 🔴 Missing | Medium | Claude Code |
| Global Search (all columns) | 🔴 Partial | Low | Codex |
| CSV Export | 🔴 Missing | Low | Codex |
| EN/ES Language Toggle | 🔴 Missing | Medium | Claude Code |
| Photo Galleries | 🔴 Missing | Medium | Codex |
| Image Modal Viewer | 🔴 Missing | Low | Codex |
| Sidebar Navigation | 🔴 Missing | Medium | Claude Code |

---

## 🤖 Agent Assignments

### Claude Code (Opus 4.5) — Infrastructure & Complex Features

Claude Code handles architectural decisions, shared component systems, and complex state management.

**Task 1: Table Infrastructure (PRIORITY)**
```
Create a reusable DataTable component system:
1. components/data-table/DataTable.tsx
   - Column definitions with sorting
   - Multi-select column filtering (dropdown with checkboxes)
   - Column visibility toggle
   - Responsive: table on desktop, cards on mobile
   - Loading + empty states

2. components/data-table/ColumnFilter.tsx
   - Popover with search + checkboxes
   - "Select All" / "Deselect All" buttons
   - Apply/Clear buttons

3. components/data-table/ColumnToggle.tsx
   - Dropdown to show/hide columns
   - Persist to localStorage

4. components/data-table/ExportCSV.tsx
   - Export visible data to CSV

5. hooks/useDataTable.ts
   - Sorting state
   - Filter state per column
   - Visibility state
   - Search state
```

**Task 2: Sidebar Navigation**
```
Create collapsible sidebar matching v1:
1. components/layout/Sidebar.tsx
   - Logo + title
   - Nav sections with icons
   - Sub-items (indented)
   - Collapse/expand on mobile
   - Active state highlighting

2. Update app/(dashboard)/layout.tsx
   - Sidebar + main content grid
   - Mobile bottom nav (keep existing)
   - Desktop sidebar (new)
```

**Task 3: Language System (i18n)**
```
Implement EN/ES toggle:
1. lib/i18n.ts
   - Translation keys from v1
   - useTranslation hook

2. components/layout/LanguageToggle.tsx
   - EN/ES buttons
   - Persist to localStorage
```

**Task 4: Inventory History Page**
```
Complex page with charts:
1. app/(dashboard)/inventory-history/page.tsx
   - Part selector panel (left)
   - Chart area (right)
   - Date range controls
   - Multiple parts overlay on chart

2. Use recharts or chart.js
```

**Task 5: BOM Explorer Page**
```
Complex nested data:
1. app/(dashboard)/bom/page.tsx
   - Part selector (left panel)
   - BOM details (right panel)
   - Component breakdown
   - Cost calculations
```

---

### Codex CLI (GPT-5.2) — Parallel Page Implementation

Codex handles repetitive page implementations following established patterns.

**Batch 1: Order Status Pages** (can run in parallel)

Each page follows the same pattern: fetch data → filter → display table/cards

```bash
# Run these in parallel terminals:

# Terminal 1: Need to Make
codex exec --full-auto "
Create app/(dashboard)/need-to-make/page.tsx:
- Fetch from /api/sheets (filter: status 'Released' or 'In Production', exclude shipped)
- Show columns: Line, Customer, Part Number, Qty Ordered, Qty Made, Remaining, Due Date
- Filter chips: All, Roll Tech, Molding, Snap Pad
- Use existing Card components
- Add search box (filters all visible columns)
Reference: app/(dashboard)/orders/page.tsx for pattern
"

# Terminal 2: Need to Package
codex exec --full-auto "
Create app/(dashboard)/need-to-package/page.tsx:
- Fetch from /api/sheets (filter: has inventory but not staged)
- Show columns: Line, Customer, Part Number, Qty Needed, Available Stock
- Filter chips: All, Roll Tech, Molding, Snap Pad
- Same card pattern as orders page
Reference: app/(dashboard)/orders/page.tsx
"

# Terminal 3: Shipped
codex exec --full-auto "
Create app/(dashboard)/shipped/page.tsx:
- Fetch from /api/sheets (filter: status 'Shipped')
- Show columns: Line, Customer, Part Number, Ship Date, Carrier, BOL
- Date range filter (last 7/30/90 days)
- Same card pattern
Reference: app/(dashboard)/orders/page.tsx
"
```

**Batch 2: Records Pages** (after Batch 1)

```bash
# Terminal 1: Pallet Records
codex exec --full-auto "
Create app/(dashboard)/pallet-records/page.tsx:
- New API: /api/pallet-records (fetch GID for Pallet Staging)
- Show: Date, Part Number, Pallet ID, Qty, Photos (thumbnails)
- Category filters: Roll Tech, Molding, Snap Pad
- Clicking photo opens modal
Reference: app/(dashboard)/staged/page.tsx
"

# Terminal 2: Shipping Records
codex exec --full-auto "
Create app/(dashboard)/shipping-records/page.tsx:
- New API: /api/shipping-records
- Show: Ship Date, Customer, BOL, Carrier, Items, Photos
- Date range filter
- Photo gallery per shipment
"

# Terminal 3: Staged Records
codex exec --full-auto "
Create app/(dashboard)/staged-records/page.tsx:
- Fetch staged entries with photos
- Show: Date Staged, Part Number, Location, Qty, Photo
- Similar to pallet records pattern
"
```

**Batch 3: Utility Features**

```bash
# Image Modal Component
codex exec --full-auto "
Create components/ImageModal.tsx:
- Full-screen overlay
- Click outside or X to close
- Image with max-width/height
- Keyboard: Escape to close
"

# CSV Export utility
codex exec --full-auto "
Create lib/export-csv.ts:
- Function: exportToCSV(data: any[], filename: string)
- Convert array of objects to CSV
- Trigger download
"

# Drawings Library page
codex exec --full-auto "
Create app/(dashboard)/drawings/page.tsx:
- Fetch drawing URLs from Google Sheets (Drawings tab)
- Display as thumbnail grid
- Search by part number
- Click to open full-size in modal
"
```

---

## 📋 Execution Order

### Wave 1 (Claude Code — Foundation)
1. Table Infrastructure (DataTable system)
2. Sidebar Navigation

### Wave 2 (Parallel — Codex)
Run while Claude Code works on Wave 1:
- Need to Make page
- Need to Package page
- Shipped page

### Wave 3 (Claude Code — Complex)
- Inventory History (charts)
- Language system

### Wave 4 (Parallel — Codex)
- Pallet Records
- Shipping Records
- Staged Records
- Image Modal
- Drawings Library

### Wave 5 (Claude Code — Final)
- BOM Explorer
- Integration & Polish

---

## 🔗 Data Sources (Google Sheets)

**Sheet ID:** `1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw`

| Tab | GID | Purpose |
|-----|-----|---------|
| Main Data | 290032634 | All orders |
| Fusion Export | 1805754553 | Inventory counts |
| Production Data Totals | 148810546 | Minimums/targets |
| Pallet Staging | TBD | Pallet records |
| Shipping Log | TBD | Shipping records |
| Drawings | TBD | Drawing URLs |
| BOM | TBD | Bill of materials |

---

## 🔄 Handoff Protocol

When switching agents:
1. Commit all changes with clear message
2. Update PROGRESS.md with status
3. Document blockers or decisions in this file
4. Next agent reads PROGRESS.md first

---

## ✅ Success Criteria

Feature parity with v1 dashboard:
- [ ] All 12 pages functional
- [ ] Column sorting works
- [ ] Column filtering works
- [ ] Column visibility toggle
- [ ] Search on all pages
- [ ] Category filters (Roll Tech / Molding / Snap Pad)
- [ ] Date range filters where applicable
- [ ] CSV export on data pages
- [ ] Photo thumbnails + modal viewer
- [ ] EN/ES language toggle
- [ ] Responsive (mobile cards + desktop tables)
- [ ] Sidebar navigation (desktop)
- [ ] Bottom nav (mobile) — already done
