// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { buildProductTotals, type BinlessItemInput } from './inventory-report.ts'
import type { InventoryRow } from './erpnext/inventory'

export type { InventoryRow } from './erpnext/inventory'

export interface WorkbookLabels {
  tabByBin: string
  tabByProduct: string
  bin: string
  itemCode: string
  itemName: string
  uom: string
  qty: string
  totalQty: string
  pallets: string
  legacyWarning: string
}

export interface InventoryWorkbookData {
  rows: InventoryRow[]
  binlessItems: BinlessItemInput[]
  historical?: boolean
  binsAvailable?: boolean
  legacyData?: boolean
}

export async function buildInventoryWorkbook(
  data: InventoryWorkbookData,
  labels: WorkbookLabels
): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Entech Dashboard'
  wb.created = new Date()

  const styleHeader = (ws: import('exceljs').Worksheet) => {
    const h = ws.getRow(1)
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6CB0' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, ws.rowCount), column: ws.columnCount },
    }
  }

  const palletStr = (x: InventoryRow) => x.pallets.map((p) => `${p.batch} (${p.qty})`).join(', ')

  // By Product is a totals sheet: one line per item code, no bin breakdown.
  // The same item sitting in six bins collapses to a single facility-wide
  // total — use the By Bin tab when you need to know where it is.
  const buildByProductSheet = () => {
    // Totalling + zero-fill live in lib/inventory-report.ts (with tests) — this
    // is the one number the accounting team copies out, so it is not inlined in
    // a 4k-line component where nothing can exercise it.
    const products = buildProductTotals(data.rows, data.binlessItems)
    // Historical snapshots carry no UOM — don't ship an empty column.
    const hasUom = products.some((p) => p.uom)
    const ws = wb.addWorksheet(labels.tabByProduct)
    ws.columns = [
      { header: labels.itemCode, key: 'itemCode', width: 20 },
      { header: labels.itemName, key: 'itemName', width: 44 },
      ...(hasUom ? [{ header: labels.uom, key: 'uom', width: 10 }] : []),
      { header: labels.totalQty, key: 'qty', width: 14 },
    ]
    products.forEach((p) => ws.addRow(p))
    return ws
  }

  if (!data.historical) {
    // Tab 1 — By Bin: pick a bin from the Bin column's filter dropdown.
    const byBin = wb.addWorksheet(labels.tabByBin)
    byBin.columns = [
      { header: labels.bin, key: 'warehouse', width: 28 },
      { header: labels.itemCode, key: 'itemCode', width: 20 },
      { header: labels.itemName, key: 'itemName', width: 44 },
      { header: labels.uom, key: 'uom', width: 10 },
      { header: labels.qty, key: 'qty', width: 12 },
      { header: labels.pallets, key: 'pallets', width: 50 },
    ]
    ;[...data.rows]
      .sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.itemName.localeCompare(b.itemName))
      .forEach((x) => byBin.addRow({ ...x, pallets: palletStr(x) }))
    styleHeader(byBin)

    // Tab 2 — By Product: one line per product, total on hand across all bins.
    styleHeader(buildByProductSheet())
  } else {
    const styleHistoricalHeader = (ws: import('exceljs').Worksheet) => {
      const headerRow = data.legacyData ? 2 : 1
      const h = ws.getRow(headerRow)
      h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B6CB0' } }
      ws.views = [{ state: 'frozen', ySplit: headerRow }]
      ws.autoFilter = {
        from: { row: headerRow, column: 1 },
        to: { row: Math.max(headerRow, ws.rowCount), column: ws.columnCount },
      }
    }
    const finishHistoricalSheet = (ws: import('exceljs').Worksheet) => {
      if (data.legacyData) {
        ws.insertRow(1, [labels.legacyWarning])
        ws.mergeCells(1, 1, 1, ws.columnCount)
        ws.getRow(1).font = { bold: true, color: { argb: 'FFC53030' } }
      }
      styleHistoricalHeader(ws)
    }

    if (data.binsAvailable) {
      const byBin = wb.addWorksheet(labels.tabByBin)
      byBin.columns = [
        { header: labels.bin, key: 'warehouse', width: 28 },
        { header: labels.itemCode, key: 'itemCode', width: 20 },
        { header: labels.itemName, key: 'itemName', width: 44 },
        { header: labels.uom, key: 'uom', width: 10 },
        { header: labels.qty, key: 'qty', width: 12 },
      ]
      ;[...data.rows]
        .sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.itemName.localeCompare(b.itemName))
        .forEach((x) => byBin.addRow(x))
      finishHistoricalSheet(byBin)
    }
    finishHistoricalSheet(buildByProductSheet())
  }

  const bytes = await wb.xlsx.writeBuffer()
  return new Uint8Array(bytes).buffer
}
