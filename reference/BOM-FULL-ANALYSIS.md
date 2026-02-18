# Complete BOM & Cost System Analysis

## The 3-Layer BOM Structure

### Layer 1: Individual Items (Raw Materials)
**Sheet: "BOM 1 individual items Reference data"**
- Simple 4-column table: Part Name, Description, Cost per pound/part, Supplier
- Examples: Rubber ($0.11/lb), Urethane ($1.43/lb), Plugs ($0.007/ea), Springs ($0.015/ea)
- These are the atomic building blocks — you buy these from suppliers
- **NO formulas** — just raw cost data that gets manually updated when supplier prices change

### Layer 2: Sub Assembly (Molded Parts)
**Sheet: "BOM 2 Sub assembly Reference data"**
- Each row = one molded sub-component (e.g., tire size 163, 201, 207, etc.)
- Structure: Part name, Category (Tire/Hub), Mold name, Part weight, up to 5 components, labor

**How component costs are calculated:**
- Component name → VLOOKUP to Individual Items → gets cost/lb
- Quantity = Part weight × percentage (e.g., Rubber = weight × 97%, Urethane = weight × 3%)
- Component cost = quantity × cost per pound from BOM 1
- Scrap rate (10%) applied: `= (Material costs) × scrap%`

**Labor cost:**
- Labor $/hr = $25 × 1.17 (includes benefits) = $29.25/hr
- Labor cost/part = (employees × labor rate) / parts per hour
- Example: 1 employee × $29.25/hr ÷ 54 parts/hr = $0.54/part

**Material Cost** = Sum of all component costs (including scrap)
**Total Cost** = Material Cost + Labor Cost + Overhead Cost

### Layer 3: Final Assembly (Finished Products)
**Sheet: "BOM 3 Final assembly Reference data"**
- Each row = one finished product (e.g., 620.308.2211 = SNL Hub assembly)
- Up to 13 components in groups of 3 (name, quantity, cost)

**Component cost formulas — TWO types of lookups:**
- Components 1-3: XLOOKUP to **BOM 2 Sub Assembly** → gets sub-assembly total cost
  - `= XLOOKUP(part, SubAssembly!A:A, SubAssembly!Z:Z) × qty`
  - These are the tire and hub sub-assemblies
- Components 4-13: XLOOKUP to **BOM 1 Individual Items** → gets raw material cost
  - `= XLOOKUP(part, IndividualItems!A:A, IndividualItems!C:C) × qty`
  - These are bearings, plugs, springs, packaging, etc.

**Some quantities are formulas themselves:**
- Pallet qty: `= 1 / parts_per_package` (e.g., 1/352 = 0.00284 pallets per unit)
- Stretch film: `= 500 / parts_per_package` (feet of film per unit)
- Bags: `= 3 / parts_per_package`

**Labor:**
- Labor $/hr = $25 × 1.17 = $29.25/hr
- Labor cost/part = (employees × rate) / parts_per_hour
- Shipping/QA labor = (rate × 0.666) / parts_per_package

**Subtotal Cost** = Sum of ALL 13 component costs + labor + shipping labor

**Overhead (applied as absorption percentages on subtotal):**
```
Overhead:        1.91%  →  Cost = Subtotal / (1 - 0.0191) - Subtotal
Admin expense:  11.28%  →  Cost = Subtotal / (1 - 0.1128) - Subtotal  
Depreciation:   10.55%  →  Cost = Subtotal / (1 - 0.1055) - Subtotal
Repairs/COGS:    6.58%  →  Cost = Subtotal / (1 - 0.0658) - Subtotal
```

**Final cost rollup:**
```
Variable Cost = Subtotal + Admin expense cost + Repairs/COGS cost
Total Cost    = Subtotal + ALL overhead costs (OH + Admin + Depreciation + R&S)
Profit Target = 20% (configurable)
Profit Amount = Total Cost / (1 - 20%) - Total Cost
Sales Target  = Total Cost + Profit Amount
```

## The Connection to Customer Pricing

**Sheet: "Customer Reference data"**

For each customer × product combination:
```
Internal Part # → XLOOKUP → BOM 3 Final Assembly
                              ├── Variable Cost (col BH)
                              ├── Total Cost (col BI)  
                              └── Sales Target (col BL)
```

**Contribution Level = classification based on lowest quoted tier price:**
- Price < Variable Cost   → "Critical Loss" (🔴 losing money on direct costs)
- Price < Total Cost      → "Marginal Coverage" (🟠 covers materials, not overhead)
- Price < Sales Target    → "Net Profitable" (🟡 profitable, below 20% target)
- Price ≥ Sales Target    → "Target Achieved" (🟢 meeting 20% profit goal)

## What Changes Cascade

When you change...  | It affects...
--------------------|------------------------------------------
Individual item cost (BOM 1) | Sub assembly costs → Final assembly costs → All customer contribution levels
Sub assembly component | Final assembly costs → Customer contribution levels
Overhead percentage | All Total Costs → All Sales Targets → All contribution levels
Profit target % | All Sales Targets → All contribution levels
Customer tier prices | That customer's contribution level only
Labor rate | Sub assembly + Final assembly costs → Everything downstream

## What the Dashboard BOM Editor Needs

1. **Individual Items CRUD** — edit raw material costs, add new materials
2. **Sub Assembly CRUD** — build sub-assemblies from individual items, set mold/weight/labor
3. **Final Assembly CRUD** — build finished products from sub-assemblies + individual items + packaging + labor
4. **Duplicate/Clone** — copy any BOM, swap one component (e.g., different bearing)
5. **Auto-recalculate** — when any cost changes, cascade through the entire chain
6. **Configurable overhead** — edit the 4 overhead percentages + profit target
7. **Impact analysis** — "if I change rubber cost from $0.11 to $0.12, which products are affected and by how much?"
