import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { incompletenessReasons } from './inventory-completeness.ts'

const healthy = {
  stockedCount: 493,
  rowCount: 1150,
  binlessItemsUnavailable: false,
  snapshotStocked: 493,
}

test('a normal pull is shippable', () => {
  assert.deepEqual(incompletenessReasons(healthy), [])
})

test('no bins at all is refused', () => {
  const reasons = incompletenessReasons({ ...healthy, rowCount: 0, stockedCount: 0 })
  assert.ok(reasons.some((r) => r.includes('no inventory rows')))
})

test('a missing catalog zero-fill is refused — the file would silently lose its zero parts', () => {
  const reasons = incompletenessReasons({ ...healthy, binlessItemsUnavailable: true })
  assert.ok(reasons.some((r) => r.includes('zero-quantity catalog items')))
})

test('a partial bin pull is refused even though the file would look normal', () => {
  // The failure this whole guard exists for: ERPNext hands back a subset of warehouses.
  const reasons = incompletenessReasons({ ...healthy, stockedCount: 200 })
  assert.equal(reasons.length, 1)
  assert.ok(reasons[0].includes('partial inventory'))
})

test('the check is NOT fooled by the catalog zero-fill padding the part count', () => {
  // Regression guard for the bug the review panel caught: the first version compared the
  // post-zero-fill product count, which stays ~full when bins collapse. Stocked count is
  // what must drive the decision, so a full-looking catalogue with collapsed bins is still
  // refused.
  const reasons = incompletenessReasons({
    ...healthy,
    rowCount: 40, // bins collapsed
    stockedCount: 30, // and so did the stocked parts
    snapshotStocked: 493, // while the catalogue would still have padded to ~1,142
  })
  assert.ok(reasons.some((r) => r.includes('partial inventory')))
})

test('ordinary month-to-month movement does not trip the floor', () => {
  // 400/493 = 81%, above the 75% floor: a slow month must still get its report.
  assert.deepEqual(incompletenessReasons({ ...healthy, stockedCount: 400 }), [])
})

test('exactly at the floor is allowed, one below is not', () => {
  const floor = Math.floor(493 * 0.75) // 369
  assert.deepEqual(incompletenessReasons({ ...healthy, stockedCount: floor }), [])
  assert.equal(incompletenessReasons({ ...healthy, stockedCount: floor - 1 }).length, 1)
})

test('no snapshot to compare against does not block the report', () => {
  // One broken cron must not silently take out another; the caller keeps its own baseline.
  assert.deepEqual(incompletenessReasons({ ...healthy, stockedCount: 5, snapshotStocked: null }), [])
})

test('an empty snapshot is treated as no snapshot, not as a zero floor', () => {
  assert.deepEqual(incompletenessReasons({ ...healthy, stockedCount: 5, snapshotStocked: 0 }), [])
})

test('several faults are all reported, not just the first', () => {
  const reasons = incompletenessReasons({
    stockedCount: 0,
    rowCount: 0,
    binlessItemsUnavailable: true,
    snapshotStocked: 493,
  })
  assert.equal(reasons.length, 3)
})
