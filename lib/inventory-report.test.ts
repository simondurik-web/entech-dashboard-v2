import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProductTotals } from './inventory-report.ts'

const stocked = [
  { itemCode: '648.254.1530', itemName: '10" X 2-3/4" VSP WHEEL - BORE 5/8"', uom: 'pcs', qty: 3000 },
  { itemCode: '648.254.1530', itemName: '10" X 2-3/4" VSP WHEEL - BORE 5/8"', uom: 'pcs', qty: 923 },
]

test('the same item in several bins collapses to one facility-wide total', () => {
  const products = buildProductTotals(stocked)
  assert.equal(products.length, 1)
  assert.equal(products[0].qty, 3923)
})

test('a zero-stock catalog part still gets a line — this is the whole point', () => {
  // '184' (group Tire) is Simon's example: in ERPNext, no stock, missing from the
  // old export. Accounting VLOOKUPs by part number, so a missing row reads as
  // "no such part". Passing zeroItems=[] reproduces the pre-fix behaviour and
  // this assertion fails — that is what makes the test worth having.
  const products = buildProductTotals(stocked, [{ itemCode: '184', itemName: '184', uom: 'pcs' }])
  const tire = products.find((p) => p.itemCode === '184')
  assert.ok(tire, 'zero-stock part 184 must appear on the By Product tab')
  assert.equal(tire.qty, 0)
  assert.equal(tire.uom, 'pcs')
})

test('a zero-fill entry never overwrites a part that actually has stock', () => {
  // Server-side the two sets are disjoint. If that ever breaks, the real total
  // must win — silently zeroing 3,923 wheels is worse than a duplicate row.
  const products = buildProductTotals(stocked, [
    { itemCode: '648.254.1530', itemName: '10" X 2-3/4" VSP WHEEL - BORE 5/8"', uom: 'pcs' },
  ])
  assert.equal(products.length, 1)
  assert.equal(products[0].qty, 3923)
})

test('historical zero-fill carries no UOM, so the empty column stays hidden', () => {
  // Snapshot rows have uom:'' — the sheet drops the UOM column when nothing has one.
  const products = buildProductTotals(
    [{ itemCode: '184', itemName: '184', uom: '', qty: 0 }],
    [{ itemCode: '251', itemName: '251', uom: '' }]
  )
  assert.equal(
    products.some((p) => p.uom),
    false
  )
})

test('quantities that arrive as strings add instead of concatenating', () => {
  // supabase-js hands back numeric columns as strings; the payload is cast, not validated.
  const products = buildProductTotals([
    { itemCode: 'EB-6PK', itemName: 'EB-6PK', uom: 'pcs', qty: '14000' },
    { itemCode: 'EB-6PK', itemName: 'EB-6PK', uom: 'pcs', qty: '450' },
  ])
  assert.equal(products[0].qty, 14450)
})

test('a non-numeric qty contributes zero rather than poisoning the total to NaN', () => {
  const products = buildProductTotals([
    { itemCode: 'BOX-EB-2PK', itemName: 'BOX-EB-2PK', uom: 'pcs', qty: 991 },
    { itemCode: 'BOX-EB-2PK', itemName: 'BOX-EB-2PK', uom: 'pcs', qty: 'n/a' },
  ])
  assert.equal(products[0].qty, 991)
})

test('uncoded rows are kept apart by name instead of collapsing into one bogus line', () => {
  const products = buildProductTotals([
    { itemCode: '', itemName: 'Loose returns', uom: '', qty: 5 },
    { itemCode: '', itemName: 'Scrap pallet', uom: '', qty: 7 },
  ])
  assert.equal(products.length, 2)
  assert.deepEqual(
    products.map((p) => p.qty),
    [5, 7]
  )
})

test('a zero item with neither code nor name is dropped, not keyed as blank', () => {
  const products = buildProductTotals([], [{ itemCode: '', itemName: '' }])
  assert.equal(products.length, 0)
})

test('rows sort by name then code, the order accounting already reads', () => {
  const products = buildProductTotals(
    [{ itemCode: 'B', itemName: 'Alpha', uom: '', qty: 1 }],
    [
      { itemCode: 'C', itemName: 'Beta', uom: '' },
      { itemCode: 'A', itemName: 'Alpha', uom: '' },
    ]
  )
  assert.deepEqual(
    products.map((p) => p.itemCode),
    ['A', 'B', 'C']
  )
})
