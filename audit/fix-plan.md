# Fix Plan — Dashboard Feature Parity

**Created:** 2026-02-07 20:30 EST
**Priority:** Complete P0 and P1 fixes tonight

---

## 🔴 P0 FIXES (CRITICAL)

### Fix 1: Add "Hide Column" Button to Filter Dropdown

**File:** `components/data-table/ColumnFilter.tsx`

**Current state:**
```tsx
<div className="flex gap-2 pt-1 border-t">
  <Button size="sm" className="flex-1" onClick={handleApply}>
    Apply
  </Button>
  <Button variant="outline" size="sm" className="flex-1" onClick={handleClear}>
    Clear
  </Button>
</div>
```

**Required change:**
Add "Hide" button that calls a new `onHide` prop:

```tsx
interface ColumnFilterProps {
  columnKey: string
  data: unknown[]
  activeFilter: Set<string> | undefined
  onApply: (key: string, values: Set<string>) => void
  onClear: (key: string) => void
  onHide?: (key: string) => void  // NEW
}

// In the button section:
<div className="flex gap-2 pt-1 border-t">
  <Button size="sm" className="flex-1" onClick={handleApply}>
    Apply
  </Button>
  {onHide && (
    <Button variant="ghost" size="sm" onClick={() => { onHide(columnKey); setOpen(false); }}>
      👁 Hide
    </Button>
  )}
  <Button variant="outline" size="sm" onClick={handleClear}>
    Clear
  </Button>
</div>
```

**Also update:** `DataTable.tsx` to pass `onHide={toggleColumn}` to ColumnFilter

---

### Fix 2: Add Priority Column with Badges

**File:** `app/(dashboard)/orders/page.tsx`

**Add to ORDER_COLUMNS array:**
```tsx
{
  key: 'priorityLevel',
  label: 'Priority',
  sortable: true,
  filterable: true,
  render: (v, row) => {
    const priority = row.urgentOverride ? 'URGENT' : `P${v || '-'}`
    return (
      <span className={`px-2 py-0.5 text-xs rounded font-semibold ${priorityBadgeColor(priority)}`}>
        {priority}
      </span>
    )
  },
},
```

**Add helper function:**
```tsx
function priorityBadgeColor(priority: string): string {
  if (priority === 'URGENT') return 'bg-red-500 text-white animate-pulse'
  if (priority === 'P1') return 'bg-orange-500/20 text-orange-600'
  if (priority === 'P2') return 'bg-yellow-500/20 text-yellow-600'
  if (priority === 'P3') return 'bg-green-500/20 text-green-600'
  if (priority === 'P4') return 'bg-blue-500/20 text-blue-600'
  return 'bg-muted text-muted-foreground'
}
```

---

### Fix 3: Add Tire/Hub/Bearings Columns

**File:** `app/(dashboard)/orders/page.tsx`

**Add to ORDER_COLUMNS array (after Status):**
```tsx
{ key: 'tire', label: 'Tire', sortable: true, filterable: true },
{ key: 'hub', label: 'Hub', sortable: true, filterable: true },
{ key: 'bearings', label: 'Bearings', sortable: true, filterable: true },
```

**Verify data parsing in:** `lib/google-sheets.ts`
- Ensure `tire`, `hub`, `bearings` fields are being extracted from sheet

---

### Fix 4: Update Status Badge Colors

**File:** `app/(dashboard)/orders/page.tsx`

**Update statusColor function:**
```tsx
function statusColor(status: string): string {
  const s = status.toLowerCase()
  if (s === 'shipped' || s === 'invoiced') return 'bg-blue-500/20 text-blue-600'
  if (s === 'staged' || s === 'ready to ship') return 'bg-green-500/20 text-green-600'
  if (s === 'wip' || s === 'work in progress' || s === 'making' || s === 'released') return 'bg-teal-500/20 text-teal-600'
  if (s === 'pending' || s === 'need to make' || s === 'approved') return 'bg-yellow-500/20 text-yellow-600'
  if (s === 'cancelled') return 'bg-red-500/20 text-red-600'
  return 'bg-muted text-muted-foreground'
}
```

---

## 🟡 P1 FIXES (HIGH)

### Fix 5: Add Clear Filters Button with Icon

**File:** `components/data-table/DataTable.tsx`

**Update toolbar:**
```tsx
{hasActiveFilters && (
  <Button variant="destructive" size="sm" onClick={clearAllFilters}>
    <Trash2 className="size-3.5 mr-1" />
    Clear Filters
  </Button>
)}
```

---

### Fix 6: Verify Row Expansion Photo Grid

**File:** `components/OrderDetail.tsx`

**Verify it has 4 boxes:**
1. Pallet Details (blue border)
2. Fusion Pictures (teal border)
3. Shipment Photos (green border)
4. Close-Up Pictures (purple border)

---

## 📝 IMPLEMENTATION ORDER

1. ColumnFilter.tsx — Add Hide button (5 min)
2. DataTable.tsx — Pass onHide prop (2 min)
3. orders/page.tsx — Add Priority column (5 min)
4. orders/page.tsx — Add Tire/Hub/Bearings columns (3 min)
5. orders/page.tsx — Update statusColor (3 min)
6. DataTable.tsx — Improve Clear Filters button (2 min)
7. Test all changes in browser (10 min)
8. Commit and push (2 min)

**Estimated total: 30-40 minutes**

---

## 🧪 VERIFICATION STEPS

After implementing fixes:

1. Open V2 → Orders page
2. Click filter dropdown → Verify "Hide" button appears
3. Click Hide → Verify column disappears
4. Check Priority column shows with colored badges
5. Check Tire/Hub/Bearings columns visible for Roll Tech orders
6. Check Status badges have correct colors
7. Apply some filters → Verify Clear Filters button appears
8. Click row → Verify expansion shows photo boxes
9. Compare side-by-side with RT-dashboard

---

*Ready for execution*
