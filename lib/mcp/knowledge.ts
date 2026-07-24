/**
 * Entech business knowledge for AI connectors — the same domain context the
 * Phil Assistant gets, condensed and updated to the ERPNext era. Two layers:
 *
 *  - KNOWLEDGE_BRIEF rides in the MCP initialize instructions (every client
 *    sees it up front; kept tight to respect client context budgets).
 *  - KNOWLEDGE_FULL is returned by the business_context tool on demand.
 *
 * Source: PHIL_KNOWLEDGE_BASE.md (molding project), modernized 2026-07-11 —
 * Fusion-era references replaced with ERPNext, stale customer list dropped,
 * old dashboard "sales lock" rule removed (MCP access is grant-gated instead).
 */

export const KNOWLEDGE_BRIEF =
  "BUSINESS CONTEXT: Entech (Elkhart, Indiana) recycles scrap tires into crumb rubber and molds " +
  "rubber products. Three product lines: Roll Tech (molded wheels = tire + hub + optional bearings), " +
  "Molding (mats/pads/thresholds, e.g. THRESH-* parts), Snap Pad (RV leveling pads, EB-* parts). " +
  "Roll Tech part decoding: 6XX.YYY.ZZZZ = hub series XX, tire size YYY (163/201/254/261/308/405), " +
  "hub spec ZZZZ — so '619.308.2211' uses tire 308; bare 3-digit parts ARE tires; H-prefixed parts " +
  "are hubs. Order flow: pending → wip (in production) → staged (palletized, ready to ship) → " +
  "shipped. 'Loaded' counts as staged. Negative daysUntilDue = OVERDUE. Priority P1 is most urgent. " +
  "ERP = ERPNext (synced every ~5 min). Inventory 'available' = on-hand minus committed-to-orders; " +
  "below minimum = needs replenishment."

export const KNOWLEDGE_FULL = `# Entech Business Context (for AI connectors)

## Company
Entech (Elkhart, Indiana) collects scrap tires, shreds them into crumb rubber, melts tire wire
into steel ingots, and molds crumb rubber into products on hydraulic presses. ERP is ERPNext
("the ERP"); the dashboard database syncs from it every ~5 minutes, so dashboard numbers are live.

## Product lines
1. **Roll Tech** — molded rubber wheels/casters for material handling. A complete wheel =
   tire (molded crumb rubber + urethane coating) + hub (injection-molded plastic) + optional
   press-fit bearings + small parts (plugs, springs, bullets).
2. **Molding** — general molded products: floor mats, thresholds (THRESH-*), ramps, bumpers.
3. **Snap Pad** — RV/trailer jack leveling pads (EB-* part numbers, sold in multi-packs).

## Part-number decoding
- **Roll Tech finished wheel: 6XX.YYY.ZZZZ** — 6 = Roll Tech prefix, XX = hub series
  (16 = VSP press-fit, 18/19/20 = SNL snap-lock), YYY = tire size, ZZZZ = hub spec/bore/style.
  Example: 619.308.2211 = series-19 snap-lock hub, 308 tire, 22mm bore, style 11.
- **Tires** are bare 3-digit parts: 163 (1.2 lb), 201 (2.0 lb), 254 (~5 lb), 261 (2.3 lb),
  308 (4.4 lb, most common), 405 (10.6 lb).
- **Hubs: HXX.YYY.ZZZZC** — H prefix, XX hub series, YYY bore (170 = 17mm…), C color
  (B black, G gray). Example: H19.170.22100B.
- An order's tire/hub columns name the components that wheel consumes; "have tire / have hub"
  flags say whether components are in stock for it.

## Orders
- Status flow: **pending → wip → staged → shipped** ("loaded" = staged; "invoiced"/"to bill"
  count as shipped; "completed" means production finished the parts).
- **PO # is customer text** (e.g. 'PPO044775-1-LODI'), never numeric. IF # / SO # identify the
  sales order in the ERP (SO-000NN since the ERPNext cutover 2026-06-30).
- **daysUntilDue negative = overdue.** Priority P1 (highest) … P4, computed from qty vs daily
  capacity vs due date; urgent_override can force priority.
- One PO can split into multiple order lines/shipments ("legs").

## Inventory
- **available = onHand − committed** (committed = reserved to sales orders). Planning always
  uses available. Below **minimum** = replenish; minimum comes from ERPNext safety stock.
- **Counts are raw ERPNext units: a "48-pack" item counts PACKS, never multiply by pieces.**
- Component checking for wheels: an order is buildable when BOTH its tire and hub are available.

## Production
- Tires mold at ~7–54 parts/hour depending on size (405 slowest, 163/201 fastest);
  assembly runs ~37 wheels/hour/worker.
- "partsToBeMade" = cover open-order demand AND restore the minimum buffer.

## Shipping
- Staged pallets are weighed, measured, photographed (pallet records), then shipped with BOL.
- Real pallet counts come from pallet records; number_of_packages is only an estimate.
- The ERP fulfillment log records staged / shipped / BOL-signed events with SO number and user.

## E-commerce shipments (marketplace fulfillment — NOT ERPNext)
- Table **shipment_history_safe**: one row per PO line item shipped by the marketplace
  robots (Home Depot via "SPS EDI (Home Depot)", Amazon as "SPS-Amazon", more later —
  source_system is the channel; treat it as an open list). Columns: run_id, sent_at
  (timestamptz), po_number, partner, ship_to_name/address/city/state/zip, residential,
  service, source_system, tracking, part_number, qty.
- service = 'LTL (set-aside)' rows correctly have NO tracking — that is not missing data.
- Days are Eastern Time: bucket with (sent_at AT TIME ZONE 'America/New_York')::date.
- Distinct orders = COUNT(DISTINCT po_number) — a PO can span several part rows; summing
  per-part counts double-counts.
- Products: ECOBRD*/EB-* = Eco-Border, CURB-* = Curbs; color tokens RED/BRN|BR/BLK|BL/GRY|GREY.

## Costs (INTERNAL ONLY)
- BOM cost breakdown: material (mostly crumb rubber + urethane) + labor + overhead/admin/
  depreciation percentages → total cost. These are manufacturing costs, NEVER customer prices.

## Answering rules
1. Use exact numbers from tools; never estimate. State counts ("Found 5 orders:").
2. If a lookup returns nothing, the FILTER missed — check list_customers / dashboard_summary
   before saying data doesn't exist.
3. Overdue = daysUntilDue < 0 and not shipped.
4. Be concise; tables for multiple rows. Reply in the user's language (English or Spanish).`
