# Dashboard Comparison Log

**Audit Date:** 2026-02-07 20:15-20:30 EST
**RT-Dashboard:** https://simondurik-web.github.io/RT-dashboard/ (v7.28.11)
**V2 Dashboard:** https://entech-dashboard-v2.vercel.app

---

## 🔴 CRITICAL ISSUES (P0)

### 1. Filter Dropdown Missing "Hide Column" Button
**RT-Dashboard:** Filter dropdown has 3 buttons at bottom: `Clear | 👁 Hide | Apply`
**V2 Dashboard:** Filter dropdown only has 2 buttons: `Apply | Clear`

**Impact:** Users cannot hide columns from within the filter dropdown
**Fix:** Add "Hide" button to `ColumnFilter.tsx` that calls `toggleColumn()`

### 2. Missing Priority Column / Priority Badges
**RT-Dashboard:** Shows Priority column (P1, P2, P3, P4, URGENT) with colored badges
**V2 Dashboard:** No Priority column visible, statuses show as plain text "Pending", "Staged", etc.

**Impact:** Critical for production planning - users need to see priority at a glance
**Fix:** Add `priorityLevel` column with badge rendering (red for URGENT, orange for P1, etc.)

### 3. Status Badge Styling Mismatch
**RT-Dashboard:** Status badges have distinct background colors:
- "Need to Make" = yellow
- "Making" = teal
- "Ready to Ship" = green  
- "URGENT" = red with pulsing animation

**V2 Dashboard:** Status shows as plain text without distinctive badges

**Impact:** Visual scanning of orders is harder
**Fix:** Update `statusColor()` function in orders page to match RT styling

### 4. Missing Columns in Orders Table
**RT-Dashboard columns:** Line, IF#, PO#, Priority, Days Until, Customer, Part#, Qty, Tire, Hub, Bearings, Status
**V2 Dashboard columns:** Line, Customer, Part#, Category, Qty, Due, IF#, Status, Assigned, PO#, Requested

**Missing in V2:**
- Priority column (critical!)
- Tire column (Roll Tech specific)
- Hub column (Roll Tech specific)
- Bearings column (Roll Tech specific)

**Extra in V2:**
- Category column
- Assigned column  
- Requested date column

**Fix:** Add missing columns, especially Priority, Tire, Hub, Bearings for Roll Tech orders

---

## 🟡 HIGH PRIORITY ISSUES (P1)

### 5. "Clear Filters" Button Not Prominent
**RT-Dashboard:** Has dedicated "🗑 Clear Filters" button with trash icon
**V2 Dashboard:** Has "Clear filters" text button that appears when filters active

**Impact:** Minor - V2 has the functionality but less visible
**Fix:** Make Clear Filters button more prominent with icon

### 6. Column Header Filter Icon Positioning
**RT-Dashboard:** Filter icon (▼) is a small button next to sort icon (↕) in header
**V2 Dashboard:** Filter icon is a funnel (🔍) button, more subtle

**Impact:** Minor visual difference
**Fix:** Consider matching RT styling with dropdown arrow instead of funnel

### 7. Days Until vs Due Display
**RT-Dashboard:** Shows "Days Until" with negative numbers for overdue (-31, -30, etc.) in red
**V2 Dashboard:** Shows "Due" with "Overdue" text or days like "87d"

**Impact:** V2 is clearer with "Overdue" text, but RT shows exact days overdue
**Fix:** Consider showing both - "Overdue (-31d)" for clarity

### 8. Row Expansion/Drilldown Not Tested
**RT-Dashboard:** Click row to expand and see 4-box photo grid (Pallet Details, Fusion Pics, Shipment, Close-Up)
**V2 Dashboard:** Has `OrderDetail.tsx` component but need to verify it matches RT

**Status:** Needs functional testing
**Fix:** Verify OrderDetail matches RT's 4-box layout

---

## 🟢 WORKING CORRECTLY

### ✅ Category Filter Chips
Both dashboards have: All, Roll Tech, Molding, Snap Pad buttons

### ✅ Status Filter Chips  
Both dashboards have: Need to Make, Making, Ready to Ship, Shipped buttons

### ✅ Search Box
Both have global search functionality

### ✅ Columns Toggle Button
Both have "⚙️ Columns" button for show/hide columns

### ✅ Export Button
Both have CSV export functionality

### ✅ Stats Cards
Both show: Total Orders, Need to Make, Making, Ready to Ship counts

### ✅ Auto-Refresh
V2 has "Auto 4m 42s" with countdown - this is a V2 enhancement not in RT

### ✅ Sidebar Navigation
Both have similar navigation with icons and sections

### ✅ Dark/Light Theme Toggle
Both support theme switching

### ✅ Language Toggle (EN/ES)
Both support English/Spanish

---

## 📋 DETAILED FEATURE COMPARISON

| Feature | RT-Dashboard | V2 Dashboard | Match? |
|---------|-------------|--------------|--------|
| Column filter dropdown | ✅ Full (Clear/Hide/Apply) | ⚠️ Missing Hide | ❌ |
| Priority badges | ✅ P1/P2/P3/P4/URGENT | ❌ Not visible | ❌ |
| Status badges | ✅ Colored | ⚠️ Plain text | ❌ |
| Tire/Hub/Bearings cols | ✅ Shown | ❌ Hidden | ❌ |
| Category chips | ✅ Yes | ✅ Yes | ✅ |
| Status chips | ✅ Yes | ✅ Yes | ✅ |
| Clear Filters btn | ✅ Prominent | ⚠️ Subtle | ⚠️ |
| Search | ✅ Yes | ✅ Yes | ✅ |
| Columns toggle | ✅ Yes | ✅ Yes | ✅ |
| CSV Export | ✅ Yes | ✅ Yes | ✅ |
| Auto-refresh | ❌ Manual | ✅ Auto + countdown | V2 better |
| Row click expand | ✅ 4-box photos | ? Need to test | ? |
| Photo lightbox | ✅ Full featured | ? Need to test | ? |
| Phil Assistant | ✅ Yes | ✅ Button present | Need test |
| Zoom control | ✅ Yes | ❌ Not visible | ❌ |

---

## 📸 Screenshots Captured

1. `rt-main-dashboard.png` - RT main dashboard
2. `rt-orders-data.png` - RT orders page
3. `rt-orders-filter-dropdown.png` - RT filter dropdown with Hide button
4. `v2-orders-data.jpg` - V2 orders page
5. `v2-orders-filter-dropdown.jpg` - V2 filter dropdown (missing Hide)

---

## 🔧 RECOMMENDED FIXES

### Immediate (Tonight):

1. **Add "Hide" button to ColumnFilter.tsx**
   - Insert between Apply and Clear buttons
   - Should call parent's `toggleColumn(columnKey)` and close popover

2. **Add Priority column to Orders page**
   - Parse `priorityLevel` or `priorityOverride` from data
   - Render with colored badge (URGENT=red, P1=orange, P2=yellow, P3=green, P4=blue)

3. **Add Tire/Hub/Bearings columns**
   - Already in data, just need to add to column definitions
   - Only show for Roll Tech category orders

4. **Fix Status badge colors**
   - Match RT's color scheme exactly
   - Add "Ready to Ship" green, "Making" teal, "Need to Make" yellow

### Next Session:

5. Verify row expansion shows all 4 photo boxes
6. Test photo lightbox keyboard navigation
7. Add Zoom control to sidebar
8. Test Phil Assistant functionality
