# Sales Chart Enhancements Spec

## Branch: `feature/sales-chart-enhancements` (already created from staging)

## CRITICAL SAFETY RULES
- **DO NOT** modify any dropdown, portal, or menu component (PriorityOverride, AssigneeEditor)
- **DO NOT** change any API route or data fetching logic
- **DO NOT** modify the DataTable component or its props
- **DO NOT** add `overflow: hidden` to any container that wraps tables (this breaks dropdown portals)
- **ALL changes are additive** — new components, new sections inserted between existing elements
- Keep all existing z-index values intact
- Test that `position: fixed` portal elements still work by not wrapping chart sections in `position: relative` containers that might create new stacking contexts unnecessarily

## Recharts Already Installed
- `recharts@3.7.0` — has Treemap, PieChart, BarChart, etc. built in
- `AnimatedNumber` component exists at `components/ui/animated-number.tsx`
- `Sparkline` component exists at `components/ui/sparkline.tsx`
- `ScrollReveal` and `StaggeredGrid` exist and are used in sales-dates

## Enhancement 1: Horizontal Bar Chart for Top 10 Customers
**File:** `app/(dashboard)/sales-customers/page.tsx`
**Where:** Insert between the header/CategoryFilter and the DataTable
**What:** New component `TopCustomersBarChart` showing top 10 customers by revenue as horizontal bars, colored by margin (green if margin >= 0, red if negative). Use `BarChart` with `layout="vertical"` from recharts.
**Data:** Derive from `customerRows` — sort by revenue desc, take top 10.

## Enhancement 2: Treemap for Customer Revenue Concentration
**File:** `app/(dashboard)/sales-customers/page.tsx`
**Where:** Insert after the horizontal bar chart (Enhancement 1), before the DataTable
**What:** New component `CustomerTreemap` using recharts `Treemap`. Each cell sized by revenue, colored by totalMarginPct (green gradient for positive, red gradient for negative). Show customer name + revenue in each cell.
**Data:** Use all `customerRows` — each cell = { name: customer, size: revenue, margin: totalMarginPct }

## Enhancement 3: Animated Number Counters on Stat Cards
**Files:** `app/(dashboard)/sales-customers/page.tsx`, `app/(dashboard)/sales-parts/page.tsx`
**What:** The `StatCard` in sales-dates already uses `<AnimatedNumber>`. Apply the same to the StatCard components in sales-customers and sales-parts.
- Import `AnimatedNumber` from `@/components/ui/animated-number`
- Replace `<p className="text-xl font-bold mt-0.5">{value}</p>` with `<p className="text-xl font-bold mt-0.5"><AnimatedNumber value={value} duration={2500} /></p>`
- sales-dates already has this — no changes needed there.

## Enhancement 4: Donut Chart for Category Breakdown
**File:** New shared component `components/sales/CategoryDonutChart.tsx`
**Used in:** All three sales pages, inserted after stat cards (or after header area)
**What:** PieChart with inner/outer radius (donut), showing revenue by category. Center text shows total revenue. Legend below. Categories: Roll Tech (blue), Molding (yellow), Snap Pad (purple), Other (gray) — matching existing CATEGORY_CLASSES colors.
**Data:** Aggregate revenue by category from filtered orders.

## Enhancement 5: Sparklines Inline in Table Rows
**File:** `app/(dashboard)/sales-customers/page.tsx`
**What:** Add a 'Trend' column to CUSTOMER_COLUMNS that renders a tiny sparkline showing the customer's last 6 months of revenue. The sparkline data needs to come from the customer's orders grouped by month.
**IMPORTANT:** This column must be a render-only column (no sortable/filterable to keep it simple). Use the existing `Sparkline` component from `components/ui/sparkline.tsx`.
**Data:** For each CustomerRow, aggregate orders by month (last 6), extract revenue array → pass to Sparkline.

Also add to `app/(dashboard)/sales-parts/page.tsx` — same approach for parts, showing last 6 months of revenue per part.

## Enhancement 6: MoM Comparison Labels on Chart Bars
**File:** `app/(dashboard)/sales-dates/page.tsx`
**What:** Add custom `<Bar>` labels that show MoM% change above each bar in the ComposedChart. Use recharts `<Bar label={...}>` or a custom `<text>` element.
**Implementation:** Add a `label` prop to the `shippedProfit` Bar:
```tsx
label={({ x, y, width, index }: { x: number; y: number; width: number; index: number }) => {
  const mom = chartData[index]?.revMoM
  if (mom === null || mom === undefined) return null
  const color = mom >= 0 ? '#10b981' : '#ef4444'
  return <text x={x + width / 2} y={y - 8} textAnchor="middle" fill={color} fontSize={9} fontWeight={600}>{mom >= 0 ? '+' : ''}{mom.toFixed(0)}%</text>
}}
```
Keep it small (fontSize 9) so it doesn't crowd the chart.

## Enhancement 7: Gradient Background Stat Cards with Micro-Charts
**Files:** All three sales pages — update the StatCard component
**What:** Instead of a flat `border-white/[0.06]` card, add a subtle radial gradient background. Also add a tiny trend area behind the number at very low opacity.
**Implementation:** Create a new `EnhancedStatCard` component (don't modify existing StatCard to avoid breaking other pages). Use it only in the three sales pages. The micro-chart is optional data — if `trendData` prop is provided (array of numbers), render a tiny Sparkline behind the value at 8% opacity. If not provided, just show the gradient background.

## Enhancement 8: Better Tooltip Design
**File:** `app/(dashboard)/sales-customers/page.tsx` (PriceHistoryChart tooltip)
**What:** Upgrade the tooltip in PriceHistoryChart to show:
- Current unit price
- Previous data point price (from chartData[index-1])
- Change amount and % 
- Quantity for that order
Keep the dark glassmorphic style already used.

**File:** `app/(dashboard)/sales-dates/page.tsx`
**What:** The ChartTooltip is already quite good. Minor enhancement: add a small colored bar/indicator next to each P/L line showing relative magnitude. This is a visual-only addition inside the existing tooltip.

## Enhancement 9: Date Range Selector
**File:** `app/(dashboard)/sales-dates/page.tsx`
**Where:** Insert between the header row (h1 + CategoryFilter) and the StatCards
**What:** New component `DateRangeSelector` with preset buttons: "Last 3M", "Last 6M", "YTD", "Last 12M", "All Time" (default).
**Implementation:**
- Add state: `const [dateRange, setDateRange] = useState<string>('all')`
- Filter `filteredOrders` further by date range before passing to month aggregation
- Buttons are simple toggle pills, styled like the CategoryFilter pills
- **DO NOT** use any dropdown/popover for this — just inline pill buttons to avoid z-index issues

## Enhancement 10: Revenue Target Line on Monthly Chart
**File:** `app/(dashboard)/sales-dates/page.tsx`
**What:** Add a `ReferenceLine` on the ComposedChart showing a monthly revenue target.
**Implementation:**
- Calculate average monthly revenue from the data: `avgMonthlyRevenue = totals.totalRevenue / totals.monthCount`
- Add a `ReferenceLine` with `y={avgMonthlyRevenue}` on yAxisId="right", dashed, with label "Avg Revenue Target"
- Color: golden/amber `#f59e0b` with opacity 0.6
- Import `ReferenceLine` from recharts (already available)

## File Change Summary
| File | Changes |
|------|---------|
| `components/sales/CategoryDonutChart.tsx` | NEW — shared donut chart |
| `components/sales/EnhancedStatCard.tsx` | NEW — gradient stat card with micro-chart |
| `components/sales/TopCustomersBarChart.tsx` | NEW — horizontal bar chart |
| `components/sales/CustomerTreemap.tsx` | NEW — treemap visualization |
| `components/sales/DateRangeSelector.tsx` | NEW — date range pill selector |
| `app/(dashboard)/sales-customers/page.tsx` | Add bar chart, treemap, donut, sparkline column, animated numbers, enhanced stat cards, better tooltip |
| `app/(dashboard)/sales-parts/page.tsx` | Add donut, sparkline column, animated numbers, enhanced stat cards |
| `app/(dashboard)/sales-dates/page.tsx` | Add donut, MoM labels, date range selector, target line, enhanced stat cards |

## Testing Checklist
After implementing, verify:
- [ ] All three pages load without errors
- [ ] DataTable sorting/filtering still works
- [ ] Row expansion (click to drill down) still works
- [ ] Priority dropdown (if visible) still opens correctly above table
- [ ] Assignee dropdown (if visible) still opens correctly
- [ ] Category filter still works
- [ ] Export still works
- [ ] Charts render with sample data
- [ ] No console errors
- [ ] Date range selector filters correctly on sales-dates
