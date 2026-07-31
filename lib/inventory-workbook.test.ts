import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { buildInventoryWorkbook, type InventoryWorkbookData, type WorkbookLabels } from './inventory-workbook.ts'

const labels: WorkbookLabels = {
  tabByBin: 'By Bin',
  tabByProduct: 'By Product',
  bin: 'Bin',
  itemCode: 'Item Code',
  itemName: 'Item Name',
  uom: 'UOM',
  qty: 'Qty',
  totalQty: 'Total Qty',
  pallets: 'Pallets',
  legacyWarning: 'Legacy data warning',
}

const stockedRow = {
  itemCode: 'WHEEL-1',
  itemName: 'Wheel',
  uom: 'pcs',
  warehouse: 'A-01',
  qty: 10,
  pallets: [
    { batch: 'PALLET-1', qty: 4 },
    { batch: 'PALLET-2', qty: 6 },
  ],
}

async function readWorkbook(data: InventoryWorkbookData): Promise<ExcelJS.Workbook> {
  const bytes = await buildInventoryWorkbook(data, labels)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  return workbook
}

function rowValues(worksheet: ExcelJS.Worksheet, rowNumber: number): unknown[] {
  return (worksheet.getRow(rowNumber).values as unknown[]).slice(1)
}

test('live data produces By Bin and By Product, including the Pallets column', async () => {
  const workbook = await readWorkbook({ rows: [stockedRow], binlessItems: [] })

  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ['By Bin', 'By Product']
  )
  const byBin = workbook.getWorksheet('By Bin')
  assert.ok(byBin, 'By Bin sheet must exist')
  assert.deepEqual(rowValues(byBin, 1), ['Bin', 'Item Code', 'Item Name', 'UOM', 'Qty', 'Pallets'])
  assert.equal(byBin.getCell('F2').value, 'PALLET-1 (4), PALLET-2 (6)')
})

test('historical By Bin data omits the Pallets column', async () => {
  const workbook = await readWorkbook({
    rows: [stockedRow],
    binlessItems: [],
    historical: true,
    binsAvailable: true,
  })

  const byBin = workbook.getWorksheet('By Bin')
  assert.ok(byBin, 'historical By Bin sheet must exist when bins are available')
  assert.deepEqual(rowValues(byBin, 1), ['Bin', 'Item Code', 'Item Name', 'UOM', 'Qty'])
  assert.equal(byBin.columnCount, 5)
})

test('historical data without bins produces only By Product', async () => {
  const workbook = await readWorkbook({
    rows: [stockedRow],
    binlessItems: [],
    historical: true,
    binsAvailable: false,
  })

  assert.deepEqual(
    workbook.worksheets.map((worksheet) => worksheet.name),
    ['By Product']
  )
})

test('By Product omits UOM when no product carries one', async () => {
  const workbook = await readWorkbook({
    rows: [{ ...stockedRow, uom: '' }],
    binlessItems: [{ itemCode: 'ZERO-1', itemName: 'Zero item', uom: '', qty: 0 }],
    historical: true,
    binsAvailable: false,
  })

  const byProduct = workbook.getWorksheet('By Product')
  assert.ok(byProduct, 'By Product sheet must exist')
  assert.deepEqual(rowValues(byProduct, 1), ['Item Code', 'Item Name', 'Total Qty'])
  assert.equal(byProduct.columnCount, 3)
})

test('a zero-quantity binless item appears in By Product', async () => {
  const workbook = await readWorkbook({
    rows: [stockedRow],
    binlessItems: [{ itemCode: 'ZERO-1', itemName: 'Zero item', uom: 'pcs', qty: 0 }],
  })

  const byProduct = workbook.getWorksheet('By Product')
  assert.ok(byProduct, 'By Product sheet must exist')
  const zeroRow = byProduct
    .getRows(2, byProduct.rowCount - 1)
    ?.find((row) => row.getCell(1).value === 'ZERO-1')
  assert.ok(zeroRow, 'zero-quantity item must have a real row in By Product')
  assert.equal(zeroRow.getCell(4).value, 0)
})

test('legacy historical data puts the warning in row 1 and the header in row 2', async () => {
  const workbook = await readWorkbook({
    rows: [stockedRow],
    binlessItems: [],
    historical: true,
    binsAvailable: true,
    legacyData: true,
  })

  for (const sheetName of ['By Bin', 'By Product']) {
    const worksheet = workbook.getWorksheet(sheetName)
    assert.ok(worksheet, `${sheetName} sheet must exist`)
    assert.equal(worksheet.getCell('A1').value, labels.legacyWarning)
    assert.equal(worksheet.getCell('A1').isMerged, true)
    assert.equal(worksheet.getRow(1).font?.color?.argb, 'FFC53030')
    assert.equal(worksheet.getCell('A2').value, sheetName === 'By Bin' ? labels.bin : labels.itemCode)
    const view = worksheet.views[0]
    assert.equal(view && 'ySplit' in view ? view.ySplit : undefined, 2)
    assert.equal(typeof worksheet.autoFilter === 'string' && worksheet.autoFilter.startsWith('A2:'), true)
  }
})
