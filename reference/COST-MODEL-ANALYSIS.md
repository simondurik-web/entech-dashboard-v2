# Entech Cost Model Analysis

## How Costs Flow: BOM → Customer Pricing → Profit/Loss

### Layer 1: BOM (Bill of Materials) — "What does it cost to MAKE this part?"

**Sheet: "BOM 3 Final assembly Reference data"**

Each row = one finished product (e.g., 620.308.2211)

**Components (Cols 6-44):** Up to 13 component groups, each with:
- Component name (tire, hub, bearings, plugs, springs, packaging, etc.)
- Quantity per finished unit
- Cost per finished unit (already extended: qty × unit price)

**Labor (Cols 45-49):**
- Parts per hour → Labor $/hr → # employees → **Labor cost/finished part**
- Shipping/staging/QA labor cost

**Subtotal Cost (Col AY):** Sum of ALL component costs + labor
```
= Component1Cost + Component2Cost + ... + Component13Cost + LaborCost + ShippingLabor
```

**Overhead Costs (Cols AZ-BG):** Applied as percentages on top of subtotal
- Overhead: 1.91%
- Administrative expense: 11.28%
- Depreciation: 10.55%
- Repairs & Supplies COGS: 6.58%

Formula pattern: `= Subtotal / (1 - rate%) - Subtotal`

### Layer 2: Cost Rollup (Cols BH-BL) — "Full loaded cost + profit target"

- **Variable Cost (BH)** = Subtotal + Admin expense + R&S COGS
- **Total Cost (BI)** = Subtotal + ALL overhead (overhead + admin + depreciation + R&S)
- **Profit Target (BJ)** = 20% (configurable)
- **Profit Amount (BK)** = Total Cost / (1 - 20%) - Total Cost
- **Sales Target (BL)** = Total Cost + Profit Amount (= minimum sell price for 20% margin)

### Layer 3: Customer Pricing — "What do we SELL it for?"

**Sheet: "Customer Reference data"**

Each row = one customer + product combo with up to 5 tier prices.

**Key calculated fields:**
- **Lowest Quoted Price (Col S)** = MIN of all tier prices
- **Variable Cost (Col U)** = XLOOKUP(internal_part → BOM Variable Cost)
- **Total Cost (Col V)** = XLOOKUP(internal_part → BOM Total Cost)
- **Sales Target 20% (Col W)** = XLOOKUP(internal_part → BOM Sales Target)
- **Contribution Level (Col T)** = Classification based on price vs costs:
  - Sell price < Variable Cost → **"Critical Loss"** (losing money on materials alone)
  - Sell price < Total Cost → **"Marginal Coverage"** (covers materials but not overhead)
  - Sell price < Sales Target → **"Net Profitable"** (profitable but below 20% target)
  - Sell price ≥ Sales Target → **"Target Achieved"** (meeting 20% profit goal)

## The Connection

```
Individual Items (raw material costs)
    ↓
Sub Assembly BOMs (sub-component costs)
    ↓
Final Assembly BOM (full product cost = materials + labor + overhead)
    ↓
Customer Reference (sell price tiers vs. product cost = profit analysis)
    ↓
Quotes (customer-specific pricing documents)
```

## What This Means for the Dashboard

To replicate this in Supabase, we need:
1. BOM data with component costs → computes Variable Cost, Total Cost, Sales Target
2. Customer part mappings with tier prices
3. Auto-compute contribution level by comparing lowest tier price to BOM costs
4. When editing a BOM (changing a component), costs cascade to all customer pricing
5. Duplicate/clone feature: copy a BOM, swap one component, auto-recalculate
