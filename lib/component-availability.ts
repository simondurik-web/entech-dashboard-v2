import type { Order, InventoryItem } from './google-sheets-shared'
import { normalizeStatus } from './google-sheets-shared'

// Tire/Hub red-green availability for the order tables (Orders Data + Need to
// Package), computed from live data instead of the retired Google-Sheet
// "Have Tire?"/"Have Hub?" booleans (those stopped updating at the 2026-06-30
// ERPNext cutover — new order rows landed with them NULL, painting everything
// red; Simon 2026-07-07).
//
// The rule: for each tire code / hub part, sum the qty of every OPEN order
// (pending or WIP, not shipped) that uses it — that is the total number of that
// component production still has to cover. The cell is GREEN only when current
// stock covers BOTH that open demand AND the item's minimum ("keep it ready"
// buffer); otherwise RED = the production team needs to make more.

export interface ComponentAvailability {
  inStock: number
  minimum: number
  /** Total qty required by open (pending/WIP, unshipped) orders using this component. */
  demand: number
  ok: boolean
}

export type ComponentAvailabilityMap = Map<string, ComponentAvailability>

function isRollTechCategory(category: string): boolean {
  return category.toLowerCase().includes('roll')
}

/** Open = still consumes components: pending or in production, not shipped.
 *  Staged orders are already assembled (components consumed), so they don't
 *  count toward remaining demand. */
function isOpenForDemand(o: Order): boolean {
  if (o.shippedDate) return false
  const status = normalizeStatus(o.internalStatus, o.ifStatus)
  return status === 'pending' || status === 'wip'
}

export function computeComponentAvailability(
  orders: Order[],
  inventory: InventoryItem[],
): ComponentAvailabilityMap {
  const demand = new Map<string, number>()
  for (const o of orders) {
    if (!isRollTechCategory(o.category)) continue
    if (!isOpenForDemand(o)) continue
    for (const raw of [o.tire, o.hub]) {
      const key = (raw || '').trim().toUpperCase()
      if (!key || key === '-') continue
      demand.set(key, (demand.get(key) ?? 0) + (o.orderQty || 0))
    }
  }

  const stock = new Map<string, InventoryItem>()
  for (const item of inventory) stock.set(item.partNumber.trim().toUpperCase(), item)

  const out: ComponentAvailabilityMap = new Map()
  for (const [key, needed] of demand) {
    const item = stock.get(key)
    const inStock = item?.inStock ?? 0
    const minimum = item?.minimum ?? 0
    out.set(key, {
      inStock,
      minimum,
      demand: needed,
      ok: inStock >= needed && inStock >= minimum,
    })
  }
  return out
}

/** Cell-color lookup: green when stock covers open demand + minimum. A component
 *  with no computed entry (e.g. an order in a status outside the demand window)
 *  falls back to a direct stock check against this row's qty. */
export function componentOk(
  map: ComponentAvailabilityMap,
  component: string,
  rowQty: number,
  inventoryByPart?: Map<string, InventoryItem>,
): boolean {
  const key = (component || '').trim().toUpperCase()
  const entry = map.get(key)
  if (entry) return entry.ok
  const item = inventoryByPart?.get(key)
  if (!item) return false
  return item.inStock >= rowQty && item.inStock >= (item.minimum || 0)
}
