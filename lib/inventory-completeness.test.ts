import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node's native TypeScript test runner requires the explicit extension.
import { incompletenessReasons } from './inventory-completeness.ts'

// Real figures from 2026-07-31, live against the nightly snapshot.
const healthy = {
  rowCount: 1150,
  stockedCount: 493,
  totalParts: 1142,
  binlessItemsUnavailable: false,
  snapshot: { binRows: 1152, stockedParts: 493, totalParts: 1219, unavailable: false },
}

const partial = (reasons: string[]) => reasons.some((r) => r.includes('partial inventory'))

test('a normal pull is shippable', () => {
  assert.deepEqual(incompletenessReasons(healthy), [])
})

test('the 6% skew between live and snapshot part counts is not an alarm', () => {
  // totalParts 1142 vs 1219 is normal: the snapshot keeps parts the live filter drops.
  assert.deepEqual(incompletenessReasons(healthy), [])
})

test('no bins at all is refused', () => {
  const reasons = incompletenessReasons({ ...healthy, rowCount: 0, stockedCount: 0 })
  assert.ok(reasons.some((r) => r.includes('no inventory rows')))
})

test('a missing catalog zero-fill is refused — the file would lose its zero parts', () => {
  const reasons = incompletenessReasons({ ...healthy, binlessItemsUnavailable: true })
  assert.ok(reasons.some((r) => r.includes('zero-quantity catalog items')))
})

test('a partial bin pull is refused even though the file would look normal', () => {
  assert.ok(partial(incompletenessReasons({ ...healthy, rowCount: 300, stockedCount: 200 })))
})

test('the check is NOT fooled by the catalog zero-fill padding the part count', () => {
  // The bug the panel caught: the first version compared only the post-zero-fill total,
  // which stays ~full when bins collapse. Here totalParts is untouched and it still fails.
  const reasons = incompletenessReasons({
    ...healthy,
    rowCount: 40,
    stockedCount: 30,
    totalParts: 1142,
  })
  assert.ok(partial(reasons))
})

test('a hidden warehouse is caught even when its parts are stocked elsewhere', () => {
  // Codex's case: omit a warehouse whose every part also lives in another bin. Part counts
  // do not move at all — only the bin rows do, which is why bin rows are checked separately.
  const reasons = incompletenessReasons({
    ...healthy,
    rowCount: 1000, // rows vanished with the warehouse
    stockedCount: 493, // unchanged
    totalParts: 1142, // unchanged
  })
  assert.ok(partial(reasons))
  assert.ok(reasons[0].includes('bin rows'))
})

test('a partial catalog is caught even when the bins are perfect', () => {
  // The catalog is a separate call with its own failure mode. A short catalog silently
  // drops zero-quantity parts, breaking exactly the lookups the zero-fill exists for.
  const reasons = incompletenessReasons({ ...healthy, totalParts: 900 })
  assert.ok(partial(reasons))
  assert.ok(reasons[0].includes('parts listed'))
})

test('ordinary month-to-month movement does not trip any floor', () => {
  assert.deepEqual(
    incompletenessReasons({ ...healthy, rowCount: 1100, stockedCount: 470, totalParts: 1080 }),
    []
  )
})

test('exactly at the floor is allowed, one below is not', () => {
  const floor = Math.floor(493 * 0.95) // 468
  assert.deepEqual(incompletenessReasons({ ...healthy, stockedCount: floor }), [])
  assert.ok(partial(incompletenessReasons({ ...healthy, stockedCount: floor - 1 })))
})

test('no snapshot to compare against does not block the report', () => {
  // One broken cron must not silently take out another; the caller keeps its own baseline.
  assert.deepEqual(
    incompletenessReasons({
      ...healthy,
      rowCount: 5,
      stockedCount: 5,
      totalParts: 5,
      snapshot: { binRows: null, stockedParts: null, totalParts: null, unavailable: false },
    }),
    []
  )
})

test('an empty snapshot is treated as no snapshot, not as a zero floor', () => {
  assert.deepEqual(
    incompletenessReasons({
      ...healthy,
      stockedCount: 5,
      snapshot: { binRows: 0, stockedParts: 0, totalParts: 0, unavailable: false },
    }),
    []
  )
})

test('every shortfall is named, so the alert says what actually went wrong', () => {
  const reasons = incompletenessReasons({
    ...healthy,
    rowCount: 10,
    stockedCount: 10,
    totalParts: 10,
  })
  assert.equal(reasons.length, 1)
  for (const label of ['bin rows', 'parts with stock', 'parts listed']) {
    assert.ok(reasons[0].includes(label), `expected "${label}" in: ${reasons[0]}`)
  }
})

test('several distinct faults are all reported, not just the first', () => {
  const reasons = incompletenessReasons({
    ...healthy,
    rowCount: 0,
    stockedCount: 0,
    totalParts: 0,
    binlessItemsUnavailable: true,
  })
  assert.equal(reasons.length, 3)
})

test('a failed snapshot query is refused, not silently skipped', () => {
  // Codex's case: discarding the error turns "we checked and it is fine" into "we did not
  // check". An unverified pull must not be reported as a verified one.
  const reasons = incompletenessReasons({
    ...healthy,
    snapshot: { binRows: null, stockedParts: null, totalParts: null, unavailable: true },
  })
  assert.ok(reasons.some((r) => r.includes('completeness is unverified')))
})

test('a tight floor now catches the omission the single loose floor let through', () => {
  // 1,050 bin rows and 1,000 listed parts passed under one 0.75 floor despite losing 102
  // bin rows and 142 catalogue entries.
  const reasons = incompletenessReasons({
    ...healthy,
    rowCount: 1050,
    stockedCount: 493,
    totalParts: 1000,
  })
  assert.ok(partial(reasons))
  assert.ok(reasons[0].includes('bin rows'))
  assert.ok(reasons[0].includes('parts listed'))
})
