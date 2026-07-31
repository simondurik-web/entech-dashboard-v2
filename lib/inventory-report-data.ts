import { getFullInventory, listCatalogItems, type InventoryRow } from '@/lib/erpnext/inventory'

/** A part with no bin row, carrying the quantity we actually believe it has: 0 for a
 *  live catalog part, and for a dated export whatever that day's product snapshot says
 *  when the bin snapshot has no row for it. The quantity is never assumed. */
export interface BinlessItem {
  itemCode: string
  itemName: string
  uom: string
  qty: number
}

/** Every live catalog part with no stock at all, as a zero-qty entry. The client folds
 *  these into the By Product tab so the export lists every part number in ERPNext, in
 *  stock or not — accounting VLOOKUPs it, and a part that vanishes when it hits zero
 *  reads as "no such part" instead of "we're out".
 *
 *  LIVE REPORTS ONLY. A dated export zero-fills from that day's product snapshot
 *  (see `historicalResponse`) — filling it from today's catalog would date parts back
 *  to before they existed and quietly drop parts that have since been disabled.
 *
 *  `stockedCodes` comes from `getFullInventory`, which returns every NON-ZERO bin — so
 *  a part ERPNext believes is at −5 is already in that set and is never zero-filled.
 *  Reporting a negative on-hand as 0 would be a wrong number, worse than the missing row
 *  this change fixes.
 *
 *  Fails soft, but never silently: on a fetch error OR an empty catalog (never
 *  legitimate — the facility always has parts) the caller reports
 *  `binlessItemsUnavailable` so a short file is visibly short. */
async function zeroStockCatalogItems(
  stockedCodes: Set<string>
): Promise<{ items: BinlessItem[]; unavailable: boolean }> {
  try {
    const catalog = await listCatalogItems()
    if (catalog.length === 0) {
      console.error('inventory report: item catalog came back empty, exporting without zero-qty items')
      return { items: [], unavailable: true }
    }
    const items = catalog
      .filter((item) => !stockedCodes.has(item.itemCode))
      .map((item) => ({
        itemCode: item.itemCode,
        itemName: item.itemName,
        uom: item.uom,
        qty: 0,
      }))
    return { items, unavailable: false }
  } catch (error) {
    console.error('inventory report: catalog fetch failed, exporting without zero-qty items:', error)
    return { items: [], unavailable: true }
  }
}

export async function getLiveInventoryReport(): Promise<{
  rows: InventoryRow[]
  binlessItems: BinlessItem[]
  binlessItemsUnavailable: boolean
}> {
  const rows = await getFullInventory()
  // An empty Bin result is not proof the facility is empty — a changed filter, a
  // permission change or an ERPNext regression looks identical here. Zero-filling on
  // top of it would produce a fully plausible workbook stating that all 1,142 parts
  // are at zero, which is the worst possible output of this feature: confidently
  // wrong. No bins, no zero-fill, and the page says the file is incomplete.
  if (rows.length === 0) {
    console.error('inventory report: ERPNext returned no bins at all — exporting without zero-qty parts')
    return { rows, binlessItems: [], binlessItemsUnavailable: true }
  }
  const zero = await zeroStockCatalogItems(new Set(rows.map((row) => row.itemCode)))
  return { rows, binlessItems: zero.items, binlessItemsUnavailable: zero.unavailable }
}
