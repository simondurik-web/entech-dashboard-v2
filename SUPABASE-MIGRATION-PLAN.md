# Entech Dashboard V2 — Supabase Migration Plan

**Created:** 2026-02-17
**Goal:** Switch data source from Google Sheets to Supabase, then add write features

---

## Background

- Supabase project: `mqfjmzqeccufqhisqpij` (same as Entech Production App)
- DB tables already created and syncing every 5 min from Google Sheets:
  - `dashboard_orders` — 2,698 rows (Main Data tab)
  - `inventory` — 999 rows (Fusion export tab)
  - `production_totals` — 1,077 rows (Production data totals Dashboard tab)
- Sync script: `~/clawd/projects/molding/db-migration/sync_sheets_to_db.py`
- Cron: `*/5 * * * *`
- Anon key works for reads (RLS public read policies set)
- Connection: `[REDACTED - see secrets/supabase-credentials.json]`
- Supabase URL: `https://mqfjmzqeccufqhisqpij.supabase.co`
- Anon key: `[REDACTED - see secrets]`
- Service key: `[REDACTED - see secrets]`
- Credentials: `~/clawd/secrets/supabase-credentials.json`

## DB Column → Sheet Header Mapping

The sync script stores data with snake_case DB columns. The v2 dashboard currently uses camelCase JS properties mapped from Sheet column indices.

**Key mapping (dashboard_orders):**
| DB Column | Sheet Header | V2 Property |
|-----------|-------------|-------------|
| line | Line | line |
| category | Category | category |
| date_of_request | Date of Request | dateOfRequest |
| priority_level | Priority Level | priorityLevel |
| urgent_override | Urgent Override | urgentOverride |
| if_number | IF # | ifNumber |
| if_status_fusion | IF Status in Fusion | ifStatus |
| work_order_status | Work order Internal Status | internalStatus |
| po_number | PO # | poNumber |
| customer | Customer | customer |
| part_number | Part # | partNumber |
| fusion_inventory | Fusion inventory | fusionInventory |
| order_qty | Order Qty | orderQty |
| packaging | Packaging | packaging |
| parts_per_package | Parts per package | partsPerPackage |
| number_of_packages | Number of packages | numPackages |
| requested_completion_date | Requested Completion Date | requestedDate |
| days_until_promise | Days until promise date. | daysUntilDue |
| tire | Tire | tire |
| have_tire | Have Tire? | hasTire |
| hub | Hub | hub |
| have_hub | Have Hub? | hasHub |
| hub_mold | Hub Mold | hubMold |
| bearings | Bearings | bearings |
| shipped_date | Shipped Date | shippedDate |
| assigned_to | Assigned to: | assignedTo |
| weight | Weight | weight |
| dimensions | Dimensions | dimensions |
| total_tire_inventory | Total tire inventory | totalTireInventory |
| tire_cumulative_demand | Tire Cumulative demand | tireCumulativeDemand |
| total_hub_inventory | Total hub inventory | totalHubInventory |
| hub_cumulative_demand | Hub Cumulative demand | hubCumulativeDemand |
| hub_style | Hub Style | hubStyle |
| unit_price | Unit Price | unitPrice |
| contribution_level | Contribution Level | contributionLevel |
| variable_cost | Variable Cost | variableCost |
| total_cost | Total Cost | totalCost |
| sales_target_20 | Sales Target with 20% | salesTarget20 |
| profit_per_part | Profit per part | profitPerPart |
| pl | P/L | pl |
| revenue | Revenue | revenue |
| printed_by | Printed by: | printedBy |
| date_assigned | Date assigned | dateAssigned |
| enough_inventory | Enought inventory for current order | enoughInventory |
| cumulative_demand | Cummulative demand for the item | cumulativeDemand |
| daily_capacity | Daily Capacity | dailyCapacity |
| est_weight_per_pallet | Estimated weight per pallet | estWeightPerPallet |
| est_weight_for_order | Estimated weight for the order | estWeightForOrder |
| ship_to_address | shipToAddress | shipToAddress |
| bill_to_address | billToAddress | billToAddress |
| customer_number | customerNumber | customerNumber |
| min_inventory_target | Minimum inventory Target | minInventoryTarget |
| shipping_notes | shippingNotes | shippingNotes |
| picking_notes | pickingNotes | pickingNotes |
| internal_notes | internalNotes | internalNotes |
| shipping_cost | shippingCost | shippingCost |

**inventory table:**
| DB Column | V2 Use |
|-----------|--------|
| item_number | partNumber (join key) |
| real_number_value | Fusion qty |
| target | Target/minimum |

**production_totals table:**
| DB Column | V2 Use |
|-----------|--------|
| part_number | partNumber (join key) |
| product | Product type (Tire/Hub/etc.) |
| quantity_needed | Qty needed |
| minimums | Minimum inventory |
| manual_target | Manual target override |
| mold_type | Mold type |
| fusion_inventory | Fusion inventory (from prod totals) |
| parts_to_be_made | Calculated parts to make |
| drawing_1_url | Drawing URL |
| drawing_2_url | Drawing URL |
| make_purchased_com | Make/Purchased category |

---

## Step 1: Install Supabase Client & Create Data Layer

1. `cd ~/clawd/projects/entech-dashboard-v2 && npm install @supabase/supabase-js`
2. Create `lib/supabase.ts` — Supabase client with anon key
3. Create `lib/supabase-data.ts` — Data fetching functions that return the SAME types as `lib/google-sheets.ts`
   - `fetchOrdersFromDB()` → returns `Order[]`
   - `fetchInventoryFromDB()` → returns same inventory format
   - `fetchProductionTotalsFromDB()` → returns same format
   - Each function maps DB snake_case → v2 camelCase properties

## Step 2: Update API Routes (One by One)

Switch each API route from Google Sheets to Supabase. Keep Sheets functions as fallback.

**Priority order (core pages first):**
1. `/api/sheets` (Orders — main dashboard) → read from `dashboard_orders`
2. `/api/inventory` → read from `inventory` + `production_totals`
3. `/api/production-make` → read from `production_totals` + `inventory`
4. `/api/all-data` → read from `dashboard_orders` (all columns)
5. `/api/sales` → read from `dashboard_orders` (financial columns)
6. `/api/drawings` → read from `production_totals` (drawing URLs)
7. `/api/staged-records` → still from Sheets (not in DB yet)
8. `/api/shipping-records` → still from Sheets (not in DB yet)
9. `/api/pallet-records` → still from Sheets (not in DB yet)
10. `/api/bom`, `/api/bom-individual`, `/api/bom-sub` → still from Sheets
11. `/api/inventory-history` → still from Sheets
12. `/api/generic-sheet` (FP Ref, Customer Ref, Quotes) → still from Sheets

**Tabs NOT yet in Supabase (Phase 2 migration):**
- Pallet Pictures, Staged Records, Shipping Records
- BOM (3 tabs), Inventory History
- FP Reference, Customer Reference, Quotes Registry

## Step 3: Add Supabase Env Vars to Vercel

```
NEXT_PUBLIC_SUPABASE_URL=https://mqfjmzqeccufqhisqpij.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[REDACTED - see secrets]
SUPABASE_SERVICE_ROLE_KEY=[REDACTED - see secrets]
```

## Step 4: Fix Page Issues (Section by Section)

After data source is switched, go through each page and compare with HTML dashboard:
- Orders Data page — verify filtering, status logic, category tabs
- Need to Make — verify inventory vs minimums calculation
- Need to Package — verify completed logic
- Completed / Ready to Ship / Shipped — verify status filtering
- Inventory — verify merge logic (Fusion export + Prod Totals)
- Sales pages — verify financial data display
- All Data — verify all 70 columns display

**Simon will review each page and flag issues.**

## Step 5: Write Features (Phase 2)

Once reads are stable:
1. **Urgent Override toggle** — button on order row, writes to `dashboard_orders.urgent_override`
   - Also needs to sync back to Google Sheets (until Sheets is fully deprecated)
2. **Assign Worker** — dropdown on order row, writes to `dashboard_orders.assigned_to`
3. **Status updates** — move orders through workflow from dashboard
4. Eventually: stop writing to Sheets entirely, Supabase becomes source of truth

## Step 6: Migrate Remaining Tabs to Supabase

Add to sync script:
- Pallet Pictures / App Pallet Records
- Staged Records / App Staged Records  
- Shipping Records / App Shipping Records
- BOM (3 levels)
- Inventory History (daily snapshots)
- Reference data (FP, Customer, Quotes)

---

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `@supabase/supabase-js` |
| `lib/supabase.ts` | NEW — Supabase client |
| `lib/supabase-data.ts` | NEW — DB fetch functions |
| `app/api/sheets/route.ts` | Switch to Supabase |
| `app/api/inventory/route.ts` | Switch to Supabase |
| `app/api/production-make/route.ts` | Switch to Supabase |
| `app/api/all-data/route.ts` | Switch to Supabase |
| `app/api/sales/route.ts` | Switch to Supabase |
| `app/api/drawings/route.ts` | Switch to Supabase |
| `.env.local` | Add Supabase env vars |
| Vercel env vars | Add Supabase env vars |

## Current Code Structure

- `lib/google-sheets.ts` (855 lines) — ALL data fetching from Sheets
  - Uses `gviz/tq?tqx=out:json` for most queries
  - Column indices hardcoded in `COLS` object
  - Type interfaces defined: `Order`, `InventoryItem`, `ProductionItem`, etc.
- API routes in `app/api/*/route.ts` — thin wrappers calling google-sheets functions
- Pages in `app/(dashboard)/*/page.tsx` — React components consuming API routes

## Execution Notes

- Use coding agent (Claude Code or Codex) for the bulk file edits
- Test locally with `npm run dev` before pushing
- Deploy to Vercel automatically on push to main
- Keep Google Sheets functions intact as fallback (don't delete)
