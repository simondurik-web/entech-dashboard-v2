# Full Feature Parity Task - Entech Dashboard V2

**Goal:** Match the original Molding Dashboard exactly in features and design.

---

## Phase 1: Design/Color Scheme Update

Update `globals.css` and Tailwind config to match the original dashboard colors:

### Original Color Palette (MUST MATCH)

```css
/* Dark Mode */
--primary: #1a365d;
--primary-light: #2c5282;
--accent: #3182ce;
--success: #38a169;
--success-light: #68d391;
--danger: #e53e3e;
--danger-light: #fc8181;
--warning: #d69e2e;
--purple: #805ad5;
--teal: #319795;
--orange: #dd6b20;
--staged-blue: #4299e1;
--bg-dark: #1a202c;
--bg-card: #2d3748;
--text-primary: #f7fafc;
--text-secondary: #a0aec0;
--border: #4a5568;

/* Light Mode */
--primary: #2b6cb0;
--primary-light: #3182ce;
--accent: #2b6cb0;
--bg-dark: #f7fafc;
--bg-card: #ffffff;
--text-primary: #1a202c;
--text-secondary: #4a5568;
--border: #e2e8f0;
```

### Specific Elements to Style:
1. **Sidebar**: Blue gradient `linear-gradient(180deg, #1a365d 0%, #2c5282 100%)`
2. **Cards**: Dark gradient `linear-gradient(135deg, #2d3748 0%, #374151 100%)`
3. **Active nav items**: Blue glow `box-shadow: 0 4px 15px rgba(49,130,206,0.5)`
4. **Stat cards**: Accent bar at top (3px gradient)
5. **Category colors**:
   - Roll Tech: Blue `#3182ce` / `bg-blue-500/20`
   - Molding: Yellow `#d69e2e` / `bg-yellow-500/20`
   - Snap Pad: Purple `#805ad5` / `bg-purple-500/20`

---

## Phase 2: Missing Sales/P&L Pages

Create 4 new pages that fetch data from Main Data sheet and calculate P/L metrics.

### Data Source
- Sheet: Main Data (GID 290032634)
- Columns needed: Revenue, P/L, Variable Cost, Total Cost, Shipped Date, Part Number, Customer, Category

### Page 1: `/sales-overview` (P/L Overview)
- Summary cards: Total Revenue, Total Costs, Total P/L, Avg Margin %
- Pie chart: Revenue by Category (Roll Tech vs Molding vs Snap Pad)
- Line chart: P/L trend over time (last 12 months)
- Bar chart: Top 10 customers by revenue
- Filter: Date range picker

### Page 2: `/sales-parts` (By Part Number)
- Table grouped by Part Number
- Columns: Part#, Orders Count, Total Qty, Revenue, Costs, P/L, Margin%
- Sortable + filterable
- Expandable rows to show individual orders

### Page 3: `/sales-customers` (By Customer)
- Table grouped by Customer
- Columns: Customer, Orders Count, Total Qty, Revenue, Costs, P/L, Margin%
- Sortable + filterable
- Click to drill down to customer's orders

### Page 4: `/sales-dates` (By Date)
- Table grouped by Month (using Shipped Date)
- Columns: Month, Orders Count, Total Qty, Revenue, Costs, P/L, Margin%
- Bar chart showing monthly P/L

### API Route: `/api/sales`
```typescript
// Fetch Main Data, filter to shipped orders, return:
interface SalesData {
  orders: Array<{
    line: string;
    customer: string;
    partNumber: string;
    category: string;
    qty: number;
    revenue: number;
    variableCost: number;
    totalCost: number;
    pl: number;
    shippedDate: string;
  }>;
  summary: {
    totalRevenue: number;
    totalCosts: number;
    totalPL: number;
    avgMargin: number;
    orderCount: number;
  };
}
```

---

## Phase 3: Drawing Integration in Order Views

When clicking an order row, show tire/hub drawings inline.

### What the original does:
1. Load drawings from Production Data Totals (columns L & M have URLs)
2. Build `drawingMap` keyed by part number
3. `showPalletPictures()` displays: pallet photos + tire drawing + hub drawing

### Implementation for V2:
1. **API route** `/api/drawings` already exists - verify it returns drawing URLs
2. **Modify** `OrderDetail.tsx` component to:
   - Accept `tirePartNum` and `hubPartNum` from order data
   - Fetch/match drawings from API
   - Display drawing thumbnails with click-to-enlarge
3. **Apply to pages**: Orders, Need to Package, Staged, Shipped

### Drawing Display Format:
```tsx
<div className="mt-4 border-t pt-4">
  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
    📐 Drawings
  </h4>
  <div className="flex gap-4">
    {tireDrawing && (
      <div className="cursor-pointer" onClick={() => openLightbox(tireDrawing)}>
        <img src={tireDrawing} className="h-24 rounded border" />
        <span className="text-xs text-muted-foreground">Tire: {tirePartNum}</span>
      </div>
    )}
    {hubDrawing && (
      <div className="cursor-pointer" onClick={() => openLightbox(hubDrawing)}>
        <img src={hubDrawing} className="h-24 rounded border" />
        <span className="text-xs text-muted-foreground">Hub: {hubPartNum}</span>
      </div>
    )}
  </div>
</div>
```

---

## Phase 4: Update Sidebar Navigation

Current V2 sidebar is missing Sales section. Update `layout.tsx`:

```tsx
// Add to sidebar nav items:
{
  section: 'Sales & Finance',
  icon: '💰',
  locked: false, // or implement password protection later
  items: [
    { href: '/sales-overview', label: 'P/L Overview', icon: '📊' },
    { href: '/sales-parts', label: 'By Part Number', icon: '🔧' },
    { href: '/sales-customers', label: 'By Customer', icon: '👥' },
    { href: '/sales-dates', label: 'By Date', icon: '📅' },
  ]
}
```

---

## Phase 5: Verification Checklist

After building, verify each feature:

### Design
- [ ] Dark mode colors match original (#1a202c, #2d3748, etc.)
- [ ] Sidebar has blue gradient
- [ ] Cards have proper styling
- [ ] Category colors correct (blue/yellow/purple)

### Sales Pages
- [ ] `/sales-overview` loads and shows data
- [ ] Charts render correctly (recharts)
- [ ] `/sales-parts` table is sortable/filterable
- [ ] `/sales-customers` table works
- [ ] `/sales-dates` grouped by month

### Drawing Integration
- [ ] Click order row → shows drawings if available
- [ ] Tire and Hub drawings display correctly
- [ ] Click drawing → opens lightbox
- [ ] Works on: Orders, Need to Package, Staged, Shipped

### Navigation
- [ ] Sales section in sidebar
- [ ] All links work
- [ ] Active state shows correctly

---

## Files to Create/Modify

### New Files:
- `app/(dashboard)/sales-overview/page.tsx`
- `app/(dashboard)/sales-parts/page.tsx`
- `app/(dashboard)/sales-customers/page.tsx`
- `app/(dashboard)/sales-dates/page.tsx`
- `app/api/sales/route.ts`

### Modify:
- `app/globals.css` - colors
- `tailwind.config.ts` - add custom colors
- `app/(dashboard)/layout.tsx` - sidebar nav
- `components/OrderDetail.tsx` - add drawings
- All order pages - pass tire/hub data to OrderDetail

---

## Reference

- Original dashboard: `~/clawd/projects/molding/molding_dashboard_production.html`
- V2 project: `~/clawd/projects/entech-dashboard-v2/`
- Live V2: https://entech-dashboard-v2.vercel.app

**Run dev server:** `cd ~/clawd/projects/entech-dashboard-v2 && npm run dev`
**Deploy:** Push to GitHub, Vercel auto-deploys
