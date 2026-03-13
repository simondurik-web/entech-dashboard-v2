# Reset Prompt — BOM Builder Feature (2026-03-12)

Copy/paste this into the new session after reset:

---

We are working in:
`/Users/simondurik/clawd/projects/entech-dashboard-v2`

This is a **plan-first / research-first task**. Do **not** jump straight into coding.

## Goal
Build a proper BOM authoring feature in Entech Dashboard V2 so Simon can:

1. **Add a new sub-assembly** built from **individual items**
2. **Add a new final assembly** built from a **mixture of sub-assemblies and individual items**
3. Fully configure those records from the BOM page without relying on manual DB edits
4. Preserve correct cost mapping and recalculation behavior

## Critical recent context — read this first and use it to avoid repeating mistakes
We just diagnosed and fixed a BOM incident today.

### Proven root cause from today
The zero-cost BOM issue was **not** caused by the `Parts/Hr` inline editing feature itself.
The actual root cause was a **DB mapping mismatch**:

- `bom_final_assembly_components.component_source` had legacy values of `individual`
- recalc logic expected `individual_item`
- when recalc ran, valid individual item costs could be treated as missing and written back as zero

### DB fix already applied
The DB mapping was normalized:
- `individual` → `individual_item`

Current valid source vocabulary should be treated as:
- `sub_assembly`
- `individual_item`

Do **not** reintroduce `individual` anywhere in new UI, API, imports, or save logic.

## Important conclusion from today
The production/staging version with inline `Parts/Hr` editing and recalculation is okay **as long as the mapping is correct**.
So this new feature should preserve that behavior, not remove it.

## Required research / analysis tasks before coding
1. Read the current BOM page and API structure
2. Trace how sub-assemblies are currently stored
3. Trace how final assemblies are currently stored
4. Trace how recalculation works today for:
   - individual item edits
   - sub-assembly edits
   - final assembly edits
5. Identify the **safest DB/UI/API design** for authoring new BOM structures
6. Confirm whether the current schema is sufficient or if small schema additions are needed
7. Produce an implementation plan for review before changing code

## Read these files first
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/CONTEXT.md`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/CODING-POLICY.md`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/app/(dashboard)/bom/page.tsx`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/lib/bom-recalculate.ts`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/app/api/bom/final-assemblies/route.ts`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/app/api/bom/sub-assemblies/route.ts`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/app/api/bom/individual-items/route.ts`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/scripts/import-bom-data.mjs`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/scripts/setup-bom-tables.sql`

## Also read today’s audit artifacts
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/audit/bom-component-source-audit-2026-03-12.md`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/audit/bom-component-source-audit-2026-03-12.json`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/audit/bom-component-source-audit-2026-03-12-corrected.md`
- `/Users/simondurik/clawd/projects/entech-dashboard-v2/audit/bom-component-source-audit-2026-03-12-corrected.json`

## Functional requirements for the new feature
### Sub-Assembly authoring
Need a flow to create a new sub-assembly with:
- part number
- category
- mold name (if applicable)
- part weight
- parts per hour
- labor rate per hour
- number of employees
- component list made from **individual items**
- quantity per component
- automatic material/labor/total calculation

### Final Assembly authoring
Need a flow to create a new final assembly with:
- part number
- product category
- sub-product category
- description
- notes
- parts per package
- parts per hour
- labor rate per hour
- number of employees
- shipping labor
- component list made from **mixed component types**:
  - sub-assemblies
  - individual items
- quantity per component
- correct stored `component_source`
- automatic subtotal/variable/total/sales target calculation

## Design constraints
- Use only valid `component_source` values:
  - `sub_assembly`
  - `individual_item`
- No manual free-text source typing in UI
- Prevent legacy invalid values from being saved
- Do not silently overwrite component mappings
- Recalc must remain deterministic and safe
- Any new create/edit flow must preserve the same calculation model already used in production
- Stage first, verify there, then ask before production

## What to deliver before implementation
I want a reviewable plan with:
1. Proposed UX flow for adding sub-assemblies and final assemblies
2. Whether dialogs, dedicated forms, inline editors, or a drawer is best
3. DB/schema review: what can stay, what must change (if anything)
4. API design for create/update of assemblies + components
5. Validation rules to prevent mapping mistakes
6. Recalc/cascade impact analysis
7. Testing checklist covering today’s bug class
8. Clear risk callouts

## If you do move to implementation after approval
- Use staging first
- Verify real BOM authoring flow end-to-end
- Specifically verify that newly created final assembly component rows store:
  - `sub_assembly`
  - `individual_item`
  and never `individual`
- Verify recalculation on newly created records
- Verify refresh persistence
- Verify no valid individual-item components zero out

## Final question to answer first in the new session
Given the current codebase and today’s BOM mapping incident, what is the safest implementation plan for adding:
- new sub-assembly creation from individual items
- new final assembly creation from sub-assemblies + individual items
without reintroducing mapping/recalc bugs?

---

When you start, summarize:
- current BOM architecture
- today’s confirmed root cause
- proposed plan
- risk areas

Then wait for approval before coding.
