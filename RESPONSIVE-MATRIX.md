# V2 Dashboard — Responsive Matrix

**Last Updated:** 2026-02-13

## Breakpoints

| Device | Width | View | Status |
|--------|-------|------|--------|
| 📱 iPhone | <640px | Card view (stacked, touch-friendly) | ✅ Active |
| 📱 iPad | 640-1024px | DataTable (horizontal scroll if needed) | ✅ Active |
| 🖥️ Desktop | >1024px | Full DataTable (all columns visible) | ✅ Active |

**Tailwind class mapping:**
- `sm:hidden` = iPhone-only content (hidden on iPad+Desktop)
- `hidden sm:block` = iPad+Desktop content (hidden on iPhone)

## Page Status

| Page | Desktop Table | iPad Table | iPhone Cards | i18n (EN/ES) | Filters Working | Notes |
|------|:---:|:---:|:---:|:---:|:---:|-------|
| Orders | ✅ | ✅ | ✅ | ❌ TODO | ❓ Check | Has OrderCard |
| Need to Make | ✅ | ✅ | ✅ | ❌ TODO | ❓ Check | Uses DataTable |
| Need to Package | ✅ | ✅ | ✅ | ❌ TODO | ❓ Check | Uses DataTable |
| Staged (Ready to Ship) | ✅ | ✅ | ✅ | ❌ TODO | ❓ Check | Has PLC below |
| Shipped | ✅ | ✅ | ✅ | ❌ TODO | ❓ Check | Uses DataTable |
| Inventory | ✅ | ✅ | ✅ | ❌ TODO | ❓ Check | Has InventoryCard, forecast cols |
| All Data | ✅ | ✅ | ➖ hint | ❌ TODO | ❓ Check | Raw table, no cards |
| Material Requirements | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | New page |
| Sales Overview | ✅ | ✅ | ❓ | ❌ TODO | N/A | Charts |
| Sales by Customer | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | Password gated |
| Sales by Date | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | Password gated |
| Sales by Part | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | Password gated |
| Drawings Library | ✅ | ✅ | ❓ | ❌ TODO | N/A | |
| Quotes | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| BOM | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| Pallet Records | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| Shipping Records | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| Customer Reference | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| FP Reference | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| Inventory History | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |
| Staged Records | ✅ | ✅ | ❓ | ❌ TODO | ❓ Check | |

### Legend
- ✅ Done & tested
- ❌ Not done
- ❓ Needs testing/review
- ➖ Not applicable / minimal

## Known Issues (Simon's Review 2026-02-13)
1. **Translations incomplete** — many parts not translated to Spanish
2. **Header filters not working** on some tables — need to audit each page
3. ~~Mobile cards overriding desktop tables~~ — **FIXED** (breakpoint changed to sm/640px)

## Architecture Notes

### DataTable Component
- Location: `components/data-table/DataTable.tsx`
- Breakpoint: `sm` (640px) — cards below, table above
- `renderCard` prop: optional per-page card renderer for iPhone
- `DefaultCard`: auto-generated card from column defs (fallback)
- Search, sort, filter, column toggle, CSV export built-in

### Card Components
- `components/cards/OrderCard.tsx` — used by Orders, Need to Make, Need to Package, Staged, Shipped
- `components/cards/InventoryCard.tsx` — used by Inventory
- Only rendered on iPhone (<640px)
