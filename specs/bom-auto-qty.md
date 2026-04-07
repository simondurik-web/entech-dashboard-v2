# BOM Auto-Calculate Component Quantities

## Problem
In the Google Sheet, packaging component quantities (pallet, clear film, bags, stretch film) are calculated automatically using formulas like `=1/parts_per_package`. In the dashboard, these quantities are entered manually — they should auto-calculate.

## Google Sheet Formulas (Source of Truth)
From "BOM 3 Final assembly Reference data":

| Component | Formula | Example (PPP=360) |
|-----------|---------|-------------------|
| PALLET-42X42 | `=1/parts_per_package` | 0.002778 |
| CLEARFILMCOVER | `=3/parts_per_package` | 0.008333 |
| BAG-MOLD-COV-BLK | `=1/parts_per_package` | 0.002778 |
| FILM-STRETCH-20IN | `=500/parts_per_package` | 1.388889 |

Pattern: `numerator / parts_per_package` where numerator varies per item.

## Database
The `quantity_formula` column ALREADY EXISTS on both:
- `bom_final_assembly_components.quantity_formula` (text, nullable)
- `bom_sub_assembly_components.quantity_formula` (text, nullable)

Currently unused — all values are NULL.

## Implementation

### 1. quantity_formula Format
Store as simple string: `"N/PPP"` where N is the numerator.
- `"1/PPP"` → qty = 1 / parts_per_package
- `"3/PPP"` → qty = 3 / parts_per_package
- `"500/PPP"` → qty = 500 / parts_per_package
- NULL → manual quantity (no auto-calc)

### 2. Backend Changes (`lib/bom-recalculate.ts`)
In `recalculateFinalAssembly()`:
- Before calculating costs, for each component with a non-null `quantity_formula`:
  - Parse the formula (extract numerator from "N/PPP" format)
  - Compute `quantity = numerator / assembly.parts_per_package`
  - Update the component's `quantity` in the DB
- This way, whenever recalculate is triggered (which already happens on save), quantities auto-update.

### 3. Frontend Changes (`app/(dashboard)/bom/page.tsx`)
In the Final Assembly edit modal's component rows:
- Add a small "auto" toggle or formula input next to the Qty field
- When a formula is set (e.g., "1/PPP"):
  - Show the computed qty as read-only (grayed out)
  - Show the formula as a tooltip or small label (e.g., "1 ÷ PPP")
  - When `parts_per_package` changes in the form, recompute qty live in the UI
- When no formula is set:
  - Qty field remains editable as-is (manual entry)

### 4. Save Flow
When saving a final assembly:
- Include `quantity_formula` in the component payload
- Backend stores it in the DB
- `recalculateFinalAssembly()` uses the formula to compute actual quantity before cost calculation

### 5. Backfill Existing Data
Run a one-time SQL to set `quantity_formula` for known packaging items across all assemblies:
```sql
UPDATE bom_final_assembly_components 
SET quantity_formula = '1/PPP' 
WHERE component_part_number IN ('PALLET-42X42', 'PALLET-48X48', 'BAG-MOLD-COV-BLK')
AND component_source = 'individual_item';

UPDATE bom_final_assembly_components 
SET quantity_formula = '3/PPP' 
WHERE component_part_number = 'CLEARFILMCOVER'
AND component_source = 'individual_item';

UPDATE bom_final_assembly_components 
SET quantity_formula = '500/PPP' 
WHERE component_part_number = 'FILM-STRETCH-20IN'
AND component_source = 'individual_item';
```

### 6. Key Files to Modify
- `lib/bom-recalculate.ts` — add formula parsing + qty computation in `recalculateFinalAssembly()`
- `lib/bom-authoring.ts` — accept `quantity_formula` in component create/update
- `app/(dashboard)/bom/page.tsx` — UI for formula toggle + auto-computed qty display
- `app/api/bom/final-assemblies/route.ts` — pass through `quantity_formula`
- `app/api/bom/final-assemblies/[id]/route.ts` — pass through on update

### 7. Testing
- Edit manhole cover: set PALLET to formula "1/PPP", verify qty shows 1/360 = 0.002778
- Change parts_per_package from 360 to 100, verify qty updates to 0.01
- Save and recalculate, verify costs are correct
- Ensure manual qty items (KWH, LABOR, CORNER-PROTECTOR) are unaffected
