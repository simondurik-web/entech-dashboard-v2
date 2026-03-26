# Gleason + Precision Products standalone HTML presentation

## Goal
Create a **single standalone HTML file** for local/offline presentation use. No Supabase, no runtime fetches, no external API dependencies. All data must be embedded directly in the HTML from the prepared JSON dataset.

## Output path
`/Users/simondurik/clawd/projects/entech-dashboard-v2/presentations/gleason-precision-products.html`

## Input data
Prepared dataset:
`/Users/simondurik/clawd/projects/entech-dashboard-v2/presentations/data/gleason-precision-products.json`

This dataset already includes:
- `orders`: 32 historical Main Data rows for **Gleason Industrial Products, Inc** and **Precision Products, Inc**
- `customerReference`: customer pricing/reference rows for part `648.254.1530`
- `bomFinalAssembly`: BOM 3 final assembly row for part `648.254.1530`

## UX / design direction
- Match the **modern dashboard** feel: dark theme, polished cards, subtle glass/gradient depth, strong typography, premium presentation look.
- This is for a customer-facing presentation, so it should feel cleaner and more narrative than the internal dashboard.
- Use a dashboard-like color palette close to current Entech dashboard styling.
- Must be attractive enough to present directly in a meeting.

## Required sections

### 1) Executive header
Show:
- Title: `Gleason + Precision Products`
- Subtitle explaining this is a historical order / cost / BOM review for part `648.254.1530`
- Summary KPI cards:
  - total shipped revenue
  - total shipped P/L
  - shipped order count
  - forecast / open revenue
  - forecast / open P/L
  - average sell price
  - current total cost per part
  - current sales target

### 2) Revenue + loss history chart
Create a strong visual chart that shows, over time:
- shipment dates on x-axis
- revenue and P/L for both customers
- clearly distinguish **Gleason** vs **Precision Products**
- visually separate shipped history from open/forecast where appropriate

Good options:
- combo chart: revenue lines + P/L bars
- OR a grouped timeline / dual-axis chart

The chart must be easy to read in a presentation.

### 3) Historical orders table
Include a polished table for all relevant orders with filters/search if practical.
Recommended columns:
- customer
- line
- IF number
- PO number
- part number
- order qty
- unit price
- total cost
- revenue
- P/L
- status
- requested date
- shipped date

Presentation rule:
- highlight shipped / staged / pending / cancelled visually
- default sort by chronology

### 4) Customer pricing / quoting comparison
Use the `customerReference` data to show the specific commercial setup for both customers for `648.254.1530`.
Include:
- customer part number
- lowest quoted price
- contribution level
- variable cost
- total cost
- sales target
- tier pricing, if present

This should make it visually obvious that current pricing is below cost.

### 5) BOM section for part `648.254.1530`
Show the BOM only for this part.
Need a clear breakdown of:
- major components/subassemblies from the BOM row
- labor inputs
- overhead/admin/depreciation/repairs if available
- variable cost
- total cost
- sales target

### 6) Interactive BOM calculator
Inside the same HTML file, provide controls that let Simon adjust at minimum:
- `Parts per hour`
- `Sales target`

And automatically recalculate / reflect:
- labor cost per finished part
- subtotal / total cost per part (where impacted by parts per hour)
- margin against customer selling prices / selected sales target

If the BOM row includes enough info, also expose:
- labor cost per hour
- number of employees
- shipping/staging/QA labor cost
- overhead %
- administrative expense %
- depreciation %
- repairs & supplies COGS %

But the minimum required controls are **parts per hour** and **sales target**.

### 7) Narrative insights block
Add a short generated insight section summarizing:
- shipped volume / revenue history
- average realized pricing trend
- approximate loss pattern at current cost
- why improving parts/hour changes labor burden but does not fully close the gap if sell price stays low

Keep this concise and presentation-friendly.

## Data / logic rules
- Use the prepared dataset only.
- No network requests.
- No external chart libraries from CDN unless bundled inline locally (preferred: vanilla SVG/canvas or embedded lightweight code directly in the file).
- File must open locally via double-click in a browser.
- Handle rows with blank shipped dates gracefully.
- Treat shipped rows as historical actuals.
- Open/staged/pending rows can be shown separately as forecast/open pipeline.
- Cancelled rows should not distort shipped-history charts, but may be shown in the table with status styling.

## Implementation preferences
- One self-contained HTML file.
- Inline CSS and inline JS are fine.
- Embed the dataset inside a `<script>` tag or JS constant in the file.
- Keep code readable and easy for Marco to adjust later.

## Verification
Before finishing:
1. Open the generated HTML locally.
2. Confirm there are no console errors.
3. Confirm the interactive calculator updates live when parts/hour and sales target are changed.
4. Confirm the file works with no server.

## Deliverable
Return a short completion note with:
- output file path
- what was included
- how it was verified
