import type { Order, InventoryItem } from './google-sheets-shared'
import { normalizeStatus } from './google-sheets-shared'
import { getEffectivePriority } from './priority'

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
 *  count toward remaining demand. Exported so Need to Package filters its rows
 *  with the SAME predicate — its table is by construction the full open set
 *  the allocator ranks, never a subset. */
export function isOpenForDemand(o: Order): boolean {
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

// ---------------------------------------------------------------------------
// Per-ORDER allocation (Simon 2026-07-23): the aggregate rule above paints a
// component red on EVERY order the moment total open demand exceeds stock —
// even when stock fully covers the first order in line. The smarter rule:
// walk open orders in fulfillment order (URGENT → P1..P4, then due date, then
// line # as the entry-order tiebreak) and hand each one stock from the shared
// pool. An order is GREEN only if the pool still covers its full qty when its
// turn comes. An order that can't be covered takes nothing from the pool, so
// stock it can't use stays available to smaller orders behind it.
// Minimums stay out of the per-order verdict (they answer "should production
// make more", not "can this order be fulfilled") — the popover and Need to
// Make page still surface them.

export interface OrderAllocationVerdicts {
  /** Tire pool covers this order's qty when its turn comes (Roll Tech only). */
  tireOk?: boolean
  /** Hub pool covers this order's qty when its turn comes (Roll Tech only). */
  hubOk?: boolean
  /** Finished-part fusion inventory covers this order (Molding/SnapPad cells). */
  partOk?: boolean
  /** Finished-part ERPNext AVAILABLE stock covers this order (canPackage). */
  stockOk?: boolean
}

export type OrderAllocationMap = Map<string, OrderAllocationVerdicts>

/** Same identity the tables use for row keys — line alone can collide with
 *  archived history rows. */
export function allocationKey(o: Pick<Order, 'ifNumber' | 'line'>): string {
  return `${o.ifNumber || 'no-if'}::${o.line || 'no-line'}`
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, P1: 1, P2: 2, P3: 3, P4: 4 }

/** Days until due for ranking. The data layer maps a due-TODAY value (0) to
 *  null (`num(...) || null`), so a null falls back to parsing requestedDate —
 *  otherwise due-today orders would rank dead last in their priority band.
 *  Date-only strings parse as LOCAL midnight (new Date('YYYY-MM-DD') would be
 *  UTC midnight, flooring due-today to -1 for US-evening viewers). */
function dueDays(o: Order): number {
  if (o.daysUntilDue !== null && o.daysUntilDue !== undefined) return o.daysUntilDue
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(o.requestedDate || '')
  const due = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(o.requestedDate)
  if (isNaN(due.getTime())) return Number.MAX_SAFE_INTEGER
  const now = new Date()
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due.getTime() - todayMidnight.getTime()) / 86_400_000)
}

/** Fulfillment order: priority first, due date as tiebreak, line # (order
 *  entry sequence) as the final stable tiebreak. */
function byFulfillmentOrder(a: Order, b: Order): number {
  const aPri = PRIORITY_RANK[getEffectivePriority(a) ?? ''] ?? 99
  const bPri = PRIORITY_RANK[getEffectivePriority(b) ?? ''] ?? 99
  if (aPri !== bPri) return aPri - bPri
  const aDue = dueDays(a)
  const bDue = dueDays(b)
  if (aDue !== bDue) return aDue - bDue
  return String(a.line).localeCompare(String(b.line), undefined, { numeric: true })
}

export function computeOrderAllocations(
  orders: Order[],
  inventory: InventoryItem[],
): OrderAllocationMap {
  const invByPart = new Map<string, InventoryItem>()
  for (const item of inventory) {
    const key = (item.partNumber || '').trim().toUpperCase()
    if (key) invByPart.set(key, item)
  }

  const open = orders.filter(isOpenForDemand).sort(byFulfillmentOrder)

  // Component + ERPNext pools seed lazily from AVAILABLE stock. The fusion
  // pool seeds from the max fusionInventory seen per part (every open row of a
  // part carries the same snapshot; max guards against a stale-zero row).
  const componentPool = new Map<string, number>()
  const stockPool = new Map<string, number>()
  const fusionPool = new Map<string, number>()
  for (const o of open) {
    const key = (o.partNumber || '').trim().toUpperCase()
    if (!key) continue
    fusionPool.set(key, Math.max(fusionPool.get(key) ?? 0, o.fusionInventory || 0))
  }

  const draw = (pool: Map<string, number>, key: string, qty: number, seed: () => number): boolean => {
    if (!pool.has(key)) pool.set(key, seed())
    const remaining = pool.get(key)!
    if (remaining < qty) return false
    pool.set(key, remaining - qty)
    return true
  }

  const out: OrderAllocationMap = new Map()
  for (const o of open) {
    const verdicts: OrderAllocationVerdicts = {}
    // Clamp: a negative/NaN qty must never top a pool back up.
    const qty = Number.isFinite(o.orderQty) && o.orderQty > 0 ? o.orderQty : 0

    if (isRollTechCategory(o.category)) {
      for (const [field, raw] of [['tireOk', o.tire], ['hubOk', o.hub]] as const) {
        const key = (raw || '').trim().toUpperCase()
        if (!key || key === '-') continue
        verdicts[field] = draw(componentPool, key, qty, () => invByPart.get(key)?.inStock ?? 0)
      }
    }

    const partKey = (o.partNumber || '').trim().toUpperCase()
    if (partKey) {
      verdicts.stockOk = draw(stockPool, partKey, qty, () => invByPart.get(partKey)?.inStock ?? 0)
      verdicts.partOk = draw(fusionPool, partKey, qty, () => 0)
    }

    out.set(allocationKey(o), verdicts)
  }
  return out
}
