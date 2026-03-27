# Shipping Overview Page — Implementation Spec

## Goal
Create a new `/shipping-overview` page in the molding dashboard that replicates the daily email shipping report as a live, interactive dashboard page. This page replaces the static HTML email Phil receives — same layout, same colors, same data, but always up-to-date.

## Reference Files
- **Email HTML template:** `~/clawd/output/shipping-dashboard-2026-03-26.html` — the generated output (read this for exact visual layout)
- **Email generator script:** `~/clawd/generate-shipping-dashboard.py` — the data pipeline logic
- **Existing staged page:** `app/(dashboard)/staged/page.tsx` — reference for how to fetch data
- **Existing pallet records API:** `app/api/pallet-records/route.ts` — already merges Sheets + Supabase
- **Existing shipping records API:** `app/api/shipping-records/route.ts` — already merges Sheets + Supabase
- **Google Sheets lib:** `lib/google-sheets.ts` — fetchOrders, fetchPalletRecords, fetchShippingRecords
- **Photo resolver:** `lib/photo-resolver.ts` — resolveRecordPhotos (Google Drive URL conversion)

## Architecture

### New Files
1. `app/(dashboard)/shipping-overview/page.tsx` — Main page component
2. `app/api/shipping-overview/route.ts` — API endpoint that merges orders + pallet + shipping data
3. `components/shipping-overview/ShippingOverviewCard.tsx` — Individual order card with expandable details
4. `components/shipping-overview/PalletTable.tsx` — Pallet details table with photos
5. `components/shipping-overview/PhotoGallery.tsx` — Photo thumbnails with lightbox
6. `components/shipping-overview/ShippingStats.tsx` — Summary stats header

### API Endpoint (`/api/shipping-overview`)
The API should:
1. Fetch all orders from `/api/sheets` data (use `fetchOrders()`)
2. Fetch pallet records from `fetchPalletRecords()` + Supabase `pallet_records`
3. Fetch shipping records from `fetchShippingRecords()` + Supabase `shipping_records`
4. Filter orders into staged (status === 'staged') and shipped (last 10 days)
5. Build lookup maps: pallets by line number, shipping by IF number
6. **IMPORTANT:** When both old Forms AND new App pallets exist for the same line, keep only App pallets (deduplicate)
7. **IMPORTANT:** Do NOT use customer-name fallback for shipping photo matching — strict IF# match only
8. **IMPORTANT:** Skip ghost pallet records where pallet_number is 0 and weight is 0/empty
9. Return JSON: `{ staged: OrderWithDetails[], shipped: OrderWithDetails[], stats: SummaryStats }`

### Page Layout (Must Match Email HTML Exactly)

#### Header
- Blue gradient: `linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)`
- Title: "Shipping Dashboard" with today's date
- Stats row: Total staged orders, total shipped (10 days), total revenue, total units
- Tabs: "📋 Staged Orders (N)" and "🚚 Shipped Orders - Last 10 Days (N)"

#### Search Bar
- Full-width search that filters by customer, part #, IF#, Line #, PO #
- Instant filter (client-side)

#### Order Cards (Expandable)
Each order card shows:
- **Header (always visible):** Customer name, badge with pallet/photo count, Part#, IF#, Line#, PO#
- **Stats:** Revenue, Units, Due Date, Days Remaining (or Shipped Date + on-time/late status)
- **Color coding:**
  - OVERDUE: red text, red accent
  - Due TODAY: orange/amber
  - On time: gray
  - Shipped late: red "X days LATE"
  - Shipped early/on time: gray "X days early" / "On time"
- **Expandable details (click to toggle):**
  - 🚛 Shipping Information (pickup date, cost, address, notes) — only if data exists
  - 📦 Pallet Summary (count, total weight, dimensions)
  - 📦 Pallet Details table (columns: Pallet #, Weight, Dimensions, Photos)
  - 📸 Shipping Photos (Shipment Pictures, Paperwork Pictures, Close-up Pictures)

#### Photo Display
- **Thumbnails instead of text links** — for Supabase Storage URLs, show `<img>` thumbnails (64x64, object-fit cover, rounded corners)
- For Google Drive URLs, show clickable "Photo 1" buttons (Drive doesn't allow direct embedding)
- **Lightbox:** Click any thumbnail to see full-size in a modal overlay
- Test: Supabase URLs contain `supabase.co/storage` — those can be directly embedded as `<img src="...">`

#### Pallet Summary Box
Each order with pallets shows:
- Pallet count
- Total weight (sum of all pallet weights, formatted with commas + "lbs")
- Dimensions (if all same, show once; if mixed, show comma-separated)

### Styling Requirements
- Use the existing dashboard's Tailwind + shadcn/ui design system (dark theme compatible)
- Match the EMAIL's visual hierarchy:
  - Blue gradient header
  - White/card-based order cards with shadow
  - Green badges for photo/pallet counts
  - Alternating light/dark pallet table rows
- Use existing components where possible: `PageTransition`, `TableSkeleton`, etc.

### Command Palette Integration
Add "Shipping Overview" to the command palette items in `app/(dashboard)/layout.tsx`:
```tsx
{ label: 'Shipping Overview', href: '/shipping-overview', section: 'Production', icon: <Ship className="size-4" /> }
```
Also add it to the sidebar navigation.

### Sidebar Navigation
Add under Production section in `components/ui/collapsible-nav.tsx`, near "Shipping Records":
```
{ name: 'Shipping Overview', href: '/shipping-overview', icon: Ship }
```

## Data Matching Logic (Critical — Must Follow Exactly)

### Pallets → Orders (by Line #)
```
order.line === palletRecord.lineNumber
```

### Shipping Photos → Orders (by IF #, strict)
```
normalize(order.ifNumber) === normalize(shippingRecord.ifNumber)
```
**NO customer-name fallback.** This was causing cross-contamination in the email.

### Deduplication
If both Google Forms (old) and Entech App (new) pallet records exist for the same line number:
- Keep ONLY the App records (they have `_source: 'app'`)
- This avoids showing duplicate pallets

### Ghost Records
Skip pallet records where:
- `palletNumber` is "0" or empty
- AND `weight` is empty, "0", or "N/A"
- AND no photos

## Testing Checklist
After building, verify:
1. [ ] Page loads with real data (staged + shipped tabs)
2. [ ] Search filters correctly across customer, part#, IF#, line#
3. [ ] Order cards expand/collapse on click
4. [ ] Pallet data matches — compare against the HTML email for specific orders
5. [ ] Photos display as thumbnails for Supabase URLs
6. [ ] Lightbox works for photo viewing
7. [ ] No cross-contaminated photos (check orders from same customer — each should only show its own IF# photos)
8. [ ] No pallet #0 ghost records
9. [ ] Due date color coding works (overdue=red, today=orange, on time=gray)
10. [ ] Stats in header are accurate
11. [ ] Dark mode compatible
12. [ ] Added to sidebar nav and command palette
