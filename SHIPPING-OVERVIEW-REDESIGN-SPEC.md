# Shipping Overview Redesign Spec

## Goal
Redesign `/shipping-overview` to match the N8N email HTML dashboard layout — side-by-side columns, light theme option, day slicer, category filter, and pallet load calculator.

## Reference
The N8N HTML email dashboard (generated daily at 5 AM) is the design reference:
- Light background (#f5f7fa)
- Two-column grid: Ready to Ship (left), Shipped (right)
- Each column has its own section header, summary stats (revenue + units), search bar, and scrollable order cards
- Order cards: white bg, expandable, show customer name, part info, stats (qty, revenue, days)
- Blue gradient header at top

## Changes Required

### 1. Side-by-Side Layout (MAIN CHANGE)
Replace the current tabbed layout (Tabs switching between staged/shipped) with a **two-column grid**:
- **Left column:** Ready to Ship (staged orders)
- **Right column:** Shipped orders
- Each column has its own:
  - Section header with title and order count
  - Summary stats (revenue + units for that column only)
  - Scrollable order list
- On mobile (<1400px): stack vertically (single column)
- The existing search bar should filter BOTH columns simultaneously

### 2. Day Slicer for Shipped Orders
- Add a row of pill/chip buttons above the shipped column: `7d`, `10d`, `14d`, `30d`, `60d`, `90d`
- Default: `10d` (matches current behavior)
- When changed, the API must be called with `?days=N` query parameter
- The shipped stats (revenue, units, order count) update to reflect only orders within the selected window
- Update the API route to accept `days` query parameter instead of hardcoded 10

### 3. Light/Dark Theme Toggle
- Add a toggle button in the header area (sun/moon icon)
- **Light theme** matches the N8N email HTML exactly:
  - Body bg: #f5f7fa
  - Cards: white bg, #e1e8ed borders
  - Section titles: #1e3c72 (staged) / #27ae60 (shipped)
  - Summary values: #1e3c72 (staged) / #27ae60 (shipped)
  - Text: #2c3e50 primary, #7f8c8d secondary
  - Order cards: white bg, hover shadow, #fafbfc header
  - Expanded: #e8eef2 header bg
- **Dark theme** = current dark dashboard theme (the existing styles)
- Persist choice in localStorage key `shipping-overview-theme`
- Default to dark (matches global dashboard)

### 4. Category Filter
- Add category filter chips/buttons below the header (same pattern as sales pages)
- Categories: `Roll Tech`, `Molding`, `Snap Pad` (the standard three)
- Use the `CategoryFilter` component from `@/components/category-filter` and `filterByCategory` helper
- Filter applies to BOTH columns simultaneously

### 5. Pallet Load Calculator Button
- Add a button in the header area: "📦 Pallet Calculator"
- When clicked, opens the `PalletLoadCalculator` component from `@/components/PalletLoadCalculator.tsx`
- Pass the staged orders as `stagedOrders` prop
- Display it in a dialog/modal or collapsible section below the header
- The calculator needs `Order` type from `@/lib/google-sheets-shared` — the shipping overview orders need to be mapped to that type

### 6. Stats Updates
- ShippingStats component needs to show stats PER COLUMN:
  - Left (staged): staged order count, staged revenue, staged units
  - Right (shipped): shipped order count, shipped revenue, shipped units (within selected day window)
- Also keep a combined header stat bar

## API Changes (route.ts)

### Accept `days` query parameter:
```typescript
const url = new URL(request.url)
const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 10, 1), 365)
```
Use `days` instead of hardcoded `10` when computing `shippedCutoff`.

### Return separate stats:
```typescript
stats: {
  stagedOrders: staged.length,
  stagedRevenue: staged.reduce(...),
  stagedUnits: staged.reduce(...),
  shippedOrders: shipped.length,
  shippedRevenue: shipped.reduce(...),
  shippedUnits: shipped.reduce(...),
  totalRevenue: ...,
  totalUnits: ...,
}
```

## File Changes

1. `app/api/shipping-overview/route.ts` — accept `days` param, return per-column stats
2. `app/(dashboard)/shipping-overview/page.tsx` — full rewrite: side-by-side, theme toggle, day slicer, category filter, pallet calc button
3. `components/shipping-overview/ShippingStats.tsx` — update to support per-column stats
4. `components/shipping-overview/types.ts` — update stats type

## SAFETY
- Do NOT modify ShippingOverviewCard.tsx (the order cards work fine)
- Do NOT modify PalletLoadCalculator.tsx (just import and use it)
- Do NOT modify PalletTable.tsx or PhotoGallery.tsx
- Do NOT change the data fetching logic in the API (pallet/shipping record joins) — only change the day cutoff and stats calculation
- Do NOT break mobile responsiveness
- The CategoryFilter component already exists — just import and use it
- Keep the existing blue gradient header design
