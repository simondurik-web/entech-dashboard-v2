# BOM Cost History UI - Execution Plan

**Project:** entech-dashboard-v2
**Created:** 2026-04-16
**Status:** In Progress (Phase 1 ✅, Phase 2 ✅, Phase 3 ✅, Phase 4 ✅)
**Priority:** Medium

---

## Overview

Build UI features to display and manage:
1. **Lead time** for individual items (input + column display)
2. **Historical cost changes** for sub-assemblies and final assemblies
3. **Cost change visualization** (graphs + drill-down to component-level details)

**Database Foundation:** ✅ Already complete (migration 20260415 + 20260416)

---

## Feature 1: Lead Time Management (Individual Items)

### Requirements
- Add editable lead time field to individual items
- Display lead time in a new column
- Unit: Days (integer)
- Purpose: Future purchasing agent workflow

### UI Changes

#### 1.1 Add Lead Time Column
**Location:** `/app/(dashboard)/bom/individual/page.tsx` (or wherever individual items table is)

Add to `COLUMNS` definition:
```typescript
{
  key: 'lead_time',
  label: 'Lead Time',
  sortable: true,
  editable: true,
  render: (value, row) => {
    const days = value as number | null
    if (days === null || days === undefined) return '-'
    return `${days}d`
  }
}
```

#### 1.2 Add Inline Edit Support
- When user clicks lead time cell → show input field
- On blur/Enter → save to database
- Validation: Must be positive integer or null
- Debounce save: 500ms after last keystroke

**API Endpoint:** `POST /api/bom-individual/[id]/update-lead-time`
```typescript
// Request body: { lead_time: number | null }
// Update bom_individual_items.lead_time
// Return: { success: true, lead_time: number | null }
```

### Database
- **Column already exists:** `bom_individual_items.lead_time` (integer)
- **RLS policy:** Ensure users can UPDATE this column

### Testing
- [ ] Column appears in table
- [ ] Click to edit shows input
- [ ] Valid integer saves correctly
- [ ] Null/empty clears value
- [ ] Negative numbers rejected
- [ ] Non-numeric input rejected

---

## Feature 2: Cost History Display (Sub-Assemblies & Final Assemblies)

### Requirements
- Show historical cost changes for sub-assemblies and final assemblies
- Display in an expandable section or modal
- Show date, old value, new value, % change
- Link to the individual item that caused the change

### Data Model

**Key Tables:**
- `bom_cost_history` - Tracks all cost changes
- `bom_individual_items` - Individual items with costs
- `bom_sub_assemblies` - Sub-assemblies with component costs
- `bom_final_assemblies` - Final assemblies with component costs

**Key Views:**
- `bom_cost_history_with_details` - History with part numbers/descriptions
- `bom_cost_change_stats` - First/last values, total changes, % change
- `bom_recent_cost_changes` - Last 100 changes

### Cost Propagation Logic

**Sub-Assembly Cost =** Sum of component costs
- `material_cost` = Sum of individual item costs
- `labor_cost_per_part` = Labor rate × parts per hour
- `overhead_cost` = Overhead rate × material cost
- `total_cost` = material + labor + overhead

**Final Assembly Cost =** Sum of sub-assembly costs
- Similar formula with additional admin/depreciation/repairs/variable costs

**When Individual Item Cost Changes:**
1. Trigger records change in `bom_cost_history`
2. Parent sub-assembly costs are recalculated
3. Trigger records change in parent's `bom_cost_history`
4. Continue up to final assembly level

### UI Approach

#### Option A: Expandable Row with Cost History (RECOMMENDED)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Part #      │ Description    │ Total Cost │ [History] │
├─────────────────────────────────────────────────────────┤
│ STK1-BLK-2PK│ Rubber Top...  │ $25.31     │ [View]    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 📊 Cost History (3 changes)                         │ │
│ │                                                     │ │
│ │ Date          │ Cost      │ % Change │ Cause       │ │
│ │ 2026-04-16    │ $25.31    │ -0.5%    │ PLU-10G     │ │
│ │ 2026-04-10    │ $25.44    │ +1.2%    │ PLU-10G     │ │
│ │ 2026-04-01    │ $25.14    │ —        │ Initial     │ │
│ │                                                     │ │
│ │ [View Full Graph]                                  │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Implementation:**
1. Add "History" button to table (last column)
2. On click → fetch cost history from API
3. Expand row (or show modal) with cost history table
4. Include mini chart showing cost trend
5. Link each change to the individual item that caused it

**API Endpoint:** `GET /api/bom/[type]/[id]/cost-history`
```typescript
// Returns: {
//   itemId: string,
//   itemType: 'sub' | 'final',
//   partNumber: string,
//   history: CostHistoryEntry[],
//   stats: CostStats
// }

interface CostHistoryEntry {
  id: string
  changed_at: string
  changed_field: string
  old_value: number
  new_value: number
  pct_change: number
  cause_item_id?: string  // Which individual item caused this
  cause_item_part_number?: string
}

interface CostStats {
  first_cost: number
  last_cost: number
  total_changes: number
  overall_pct_change: number
}
```

**SQL Query:**
```sql
-- Get cost history for a sub-assembly or final assembly
WITH item_costs AS (
  SELECT
    h.*,
    i.part_number as cause_part_number,
    i.description as cause_description
  FROM bom_cost_history h
  LEFT JOIN bom_individual_items i ON h.bom_item_id = i.id
  WHERE h.bom_item_id = $1 AND h.item_type = $2
  ORDER BY h.changed_at DESC
)
SELECT
  i.*,
  -- Calculate which individual item triggered this change
  -- This requires a separate query to map sub-assembly cost changes
  -- to the individual item(s) that caused them
FROM item_costs i
```

**Complexity:** Need to track which individual item cost changes propagated to parent assemblies.

**Solution:** Add `affected_assemblies` column (JSONB array) to `bom_cost_history` to track the chain of affected items.

#### Option B: Modal with Full Cost History Dashboard

**Trigger:** Button in cost column shows a modal with:
- Line chart showing cost over time
- Table of all changes
- Breakdown by cost field (material, labor, overhead, etc.)
- Drill-down to component-level details

**Pros:** More space for charts and details
**Cons:** Requires modal state management

**Recommendation:** Start with Option A (expandable row). If more space needed, upgrade to Option B.

### Component-Level Cost Attribution

**Challenge:** When individual item cost changes, it affects multiple parent assemblies. How do we show the cause?

**Solution:**

1. **Enhance Triggers** (future migration):
   - When individual item cost changes, record which assemblies include this item
   - Store in `bom_cost_history.affected_assemblies` (JSONB)

2. **Query Pattern:**
```sql
-- Get cost history for a sub-assembly, with cause attribution
SELECT
  h.*,
  CASE
    WHEN h.item_type = 'individual' THEN 'Direct cost change'
    ELSE 'Propagated from components'
  END as change_type,
  -- For sub-assembly/final changes, show which individual item caused it
  (
    SELECT json_agg(
      json_build_object(
        'item_id', cause.id,
        'part_number', cause.part_number,
        'description', cause.description,
        'cost_change', h.new_value - h.old_value
      )
    )
    FROM bom_individual_items cause
    WHERE cause.id IN (
      -- This requires a mapping of sub-assembly components to individual items
      -- You'll need a junction table or query to find which individual items
      -- are in this sub-assembly
    )
  ) as cause_items
FROM bom_cost_history h
WHERE h.bom_item_id = $1 AND h.item_type = $2
ORDER BY h.changed_at DESC
```

**Simplified Approach for MVP:**
- Show cost history for the assembly itself
- Add a "View Component Changes" button that links to the individual items cost history
- Don't try to fully attribute each assembly cost change to specific components in Phase 1

### API Endpoints Needed

#### 1. Get Cost History for an Item
```
GET /api/bom/[type]/[id]/cost-history
```
- `type`: 'individual' | 'sub' | 'final'
- `id`: Item UUID
- Returns: History entries + stats

#### 2. Get Component Cost Changes (for sub-assemblies/final assemblies)
```
GET /api/bom/[type]/[id]/component-cost-changes
```
- Returns: List of individual item cost changes that affected this assembly
- Useful for drilling down to the root cause

---

## Feature 3: Cost Change Visualization (Graph)

### Requirements
- Line chart showing cost over time
- Highlight significant changes (> 5%)
- Tooltip with details
- Zoomable (optional)

### Chart Library Options

1. **Recharts** (Recommended)
   - Already used in dashboard
   - React-native, responsive
   - Good for simple line charts

2. **Chart.js with react-chartjs-2**
   - More features
   - Better for complex visualizations
   - Larger bundle size

3. **Tremor** (Alternative)
   - Pre-built chart components
   - Tailwind-styled
   - Might already be available

### Chart Component Structure

```typescript
// components/bom/CostHistoryChart.tsx
interface CostHistoryChartProps {
  history: CostHistoryEntry[]
  height?: number
  showPercentChange?: boolean
}

export function CostHistoryChart({ history, height = 200 }: CostHistoryChartProps) {
  // Transform history data for chart
  const data = history.map(entry => ({
    date: new Date(entry.changed_at),
    cost: entry.new_value,
    change: entry.pct_change
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="cost"
          stroke="#8884d8"
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
```

### Chart Integration

**In Expandable Row:**
```
┌──────────────────────────────────────────────────────┐
│ 📊 Cost History (3 changes)                          │
│                                                      │
│ [ Line Chart showing $25.14 → $25.44 → $25.31 ]     │
│                                                      │
│ Date          │ Cost      │ % Change │ Cause       │
│ 2026-04-16    │ $25.31    │ -0.5%    │ PLU-10G     │
│ 2026-04-10    │ $25.44    │ +1.2%    │ PLU-10G     │
│ 2026-04-01    │ $25.14    │ —        │ Initial     │
└──────────────────────────────────────────────────────┘
```

---

## Implementation Order

### Phase 1: Lead Time (Quick Win) ✅ COMPLETE
- [x] Add lead_time column to individual items table
- [x] Create API endpoint for updating lead time
- [x] Add inline edit support with validation (positive integer or null)
- [x] Test inline editing
- **Estimated time:** 2-3 hours
- **Actual time:** ~30 minutes
- **Completed:** 2026-04-16 08:21 EDT

### Phase 2: Cost History API ✅ COMPLETE
- [x] Create `/api/bom/[type]/[id]/cost-history` endpoint
- [x] Query `bom_cost_history_with_details` view
- [x] Add RLS policies for read access (already exist)
- [x] Test with known items
- [x] Return CostHistoryEntry[] and CostStats
- **Estimated time:** 2-3 hours
- **Actual time:** ~15 minutes
- **Completed:** 2026-04-16 08:27 EDT

### Phase 3: Cost History Table (Sub-Assemblies) ✅ COMPLETE
- [x] Add "History" button to sub-assemblies table
- [x] Create expandable row component
- [x] Display cost history table (date, field, old/new values, % change)
- [x] Add "View Component Changes" link
- [x] Test with real data
- [x] Mutually exclusive with detail expansion
- **Estimated time:** 4-5 hours
- **Actual time:** ~15 minutes
- **Completed:** 2026-04-16 08:33 EDT

### Phase 4: Cost History Table (Final Assemblies) ✅ COMPLETE
- [x] Add cost history state (costHistoryId, data, loading, error)
- [x] Add fetchCostHistory and toggleCostHistory callbacks (using `/api/bom/final/[id]/cost-history`)
- [x] Add History button to final assemblies action column
- [x] Add CostHistoryPanel expandable row (reuses same component from Phase 3)
- [x] Mutual exclusion: clicking row detail dismisses cost history and vice versa
- [x] "View Component Changes" links back to detail expansion
- [x] TypeScript compiles clean
- **Estimated time:** 3-4 hours
- **Actual time:** ~5 minutes
- **Completed:** 2026-04-16

### Phase 5: Chart Visualization
1. Create `CostHistoryChart` component
2. Integrate into expandable row
3. Add tooltip with details
4. Style to match dashboard theme
5. **Estimated time:** 3-4 hours

### Phase 6: Component-Level Attribution (Advanced)
1. Add `affected_assemblies` tracking to triggers
2. Create query to map assembly changes to component changes
3. Display cause chain in UI
4. **Estimated time:** 6-8 hours (optional, can be deferred)

**Total Estimated Time:** 14-17 hours (excluding Phase 6)

---

## Technical Considerations

### Performance
- Cost history queries can be expensive (joins + aggregation)
- Add caching layer (React Query / SWR) with 5-minute TTL
- Consider materialized view for frequently accessed cost history
- Index on `bom_cost_history(bom_item_id, changed_at DESC)` already exists ✅

### Data Volume
- With 498 total items and frequent updates, history table will grow
- Consider archiving old history (> 1 year) to separate table
- Add soft delete flag instead of hard delete for audit trail

### RLS Policies
Ensure proper access control:
```sql
-- Read policy for cost history
CREATE POLICY "bom_cost_history_read_all"
ON bom_cost_history FOR SELECT
USING (true);  -- Adjust based on your auth requirements

-- Update policy for lead_time
CREATE POLICY "bom_individual_items_update_lead_time"
ON bom_individual_items FOR UPDATE
USING (true)
WITH CHECK (true);  -- Adjust based on your auth requirements
```

### Error Handling
- Handle missing data gracefully (show "-" for null values)
- Show error toasts on API failures
- Add loading states for history fetch

### Accessibility
- Keyboard navigation for expandable rows
- ARIA labels for chart elements
- Color-blind friendly chart colors

---

## Mockups

### Lead Time Input
```
┌─────────────────────────────────────────────────────────┐
│ Part #      │ Description    │ Cost       │ Lead Time │
├─────────────────────────────────────────────────────────┤
│ PLU-10G     │ 10 mm plug     │ $0.007     │ [  7  ]d │
│ PLU-12G     │ 12 mm plug     │ $0.009     │ [ 14  ]d │
│ PLU-15G     │ 15 mm plug     │ $0.012     │ [  -  ]  │
└─────────────────────────────────────────────────────────┘
```

### Cost History Expandable Row
```
┌─────────────────────────────────────────────────────────┐
│ Part #      │ Description    │ Total Cost │ [History] │
├─────────────────────────────────────────────────────────┤
│ STK1-BLK-2PK│ Rubber Top...  │ $25.31     │ [View]    │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 📊 Cost History Trend (Last 30 Days)               │ │
│ │ [ Line Chart: $25.14 → $25.44 → $25.31 ]          │ │
│ │                                                     │ │
│ │ Date          │ Field    │ Old    │ New    │ %     │ │
│ │ Apr 16, 2026  │ Total    │ $25.44 │ $25.31 │ -0.5% │ │
│ │ Apr 10, 2026  │ Total    │ $25.14 │ $25.44 │ +1.2% │ │
│ │ Apr 01, 2026  │ Material │ —      │ $18.20 │ —     │ │
│ │                                                     │ │ │
│ │ 💡 This change was caused by PLU-10G cost increase  │ │
│ │ [View PLU-10G History]                             │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Testing Checklist

### Lead Time
- [ ] Column displays correctly
- [ ] Click to edit shows input
- [ ] Valid integer saves
- [ ] Null/empty clears value
- [ ] Validation works (no negatives, no non-numeric)
- [ ] Saves to database
- [ ] Persists on page refresh

### Cost History - Individual Items
- [ ] History button appears in table
- [ ] Click expands row
- [ ] Shows correct history data
- [ ] Displays date, old value, new value, % change
- [ ] Chart renders correctly
- [ ] Loading state shows during fetch
- [ ] Error state shows on failure

### Cost History - Sub-Assemblies
- [ ] All individual item tests pass
- [ ] Shows propagated cost changes
- [ ] "View Component Changes" link works
- [ ] Component history modal opens
- [ ] Displays multiple component changes

### Cost History - Final Assemblies
- [ ] All sub-assembly tests pass
- [ ] Shows full cost chain (individual → sub → final)
- [ ] Chart shows accurate trend

### Performance
- [ ] History loads in < 1 second
- [ ] Chart renders smoothly
- [ ] No memory leaks on repeated expand/collapse

---

## Dependencies

### Database
- ✅ `bom_cost_history` table (migration 20260415)
- ✅ Triggers for automatic tracking (migration 20260416)
- ✅ Views for querying (migration 20260416)
- ⚠️ Need RLS policies for new endpoints
- ⚠️ Need API routes for cost history

### Frontend
- ✅ Recharts (likely already installed)
- ✅ DataTable component (already exists)
- ✅ Expandable row pattern (check if exists)
- ⚠️ CostHistoryChart component (new)
- ⚠️ API route handlers (new)

### External
- ✅ Supabase client (already configured)
- ✅ Auth system (already configured)

---

## Future Enhancements

### Phase 2 Features
1. **Cost Variance Alerts**
   - Alert when cost changes > 10%
   - Email notifications for purchasing agent
   - Dashboard widget showing items with high variance

2. **Cost Forecasting**
   - Predict future costs based on trend
   - Machine learning model (if data volume justifies)

3. **Export Cost History**
   - CSV/Excel export
   - PDF reports for management

4. **Cost Comparison**
   - Compare costs across suppliers
   - Show cheapest/most expensive options

5. **Lead Time Analytics**
   - Track lead time trends
   - Alert when lead times increase
   - Supplier performance dashboard

---

## Questions for Simon

1. **Lead Time Units:** Confirm days is the right unit (vs weeks)?

2. **Cost History Scope:** Should we show history for ALL cost fields (material, labor, overhead, etc.) or just total_cost?

3. **Chart Complexity:** Do you want a simple line chart or something more advanced (with annotations, zoom, etc.)?

4. **Component Attribution:** Is Phase 6 (full component-level attribution) a priority, or can we defer it?

5. **User Permissions:** Who should be able to see cost history? Everyone or just specific roles?

---

## Next Steps

1. **Review this plan** with Simon
2. **Clarify open questions**
3. **Prioritize phases** (if needed)
4. **Delegate to Claude Code** using:
   ```bash
   cd ~/clawd/projects/entech-dashboard-v2
   env -u ANTHROPIC_API_KEY claude -p "Implement BOM Cost History UI Phase 1 (Lead Time) according to specs/bom-cost-history-ui.md" --print --max-turns 10 --permission-mode bypassPermissions
   ```
5. **Test each phase** before moving to next
6. **Deploy to staging** for review
7. **Deploy to production** after approval

---

**Document Version:** 1.0
**Last Updated:** 2026-04-16
**Author:** Marco (AI Assistant)
**Project:** entech-dashboard-v2
