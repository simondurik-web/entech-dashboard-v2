import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error TS5097 -- executable tests in this repository run through tsx.
import { bucketize, summarize, topPartsWithOther } from './rollup.ts'
import type { DailyRollupRow } from './types.ts'

function row(day: string, part: string, units: number | string): DailyRollupRow {
  return {
    day,
    source_system: 'SPS EDI (Home Depot)',
    part_number: part,
    service: 'FedEx Ground',
    units,
    lines: '1',
    orders: '1',
  }
}

test('week buckets use ISO Monday across a year boundary', () => {
  const buckets = bucketize([
    row('2025-12-31', 'A', '2'),
    row('2026-01-01', 'A', 3),
    row('2026-01-05', 'A', 4),
  ], 'week')

  assert.deepEqual(buckets.map((bucket) => [bucket.bucket, bucket.units]), [
    ['2025-12-29', 5],
    ['2026-01-05', 4],
  ])
})

test('quarter buckets change at calendar quarter boundaries', () => {
  const buckets = bucketize([
    row('2026-03-31', 'A', 2),
    row('2026-04-01', 'A', 3),
    row('2026-12-31', 'A', 4),
  ], 'quarter')

  assert.deepEqual(buckets.map((bucket) => bucket.bucket), ['2026-Q1', '2026-Q2', '2026-Q4'])
  assert.deepEqual(buckets.map((bucket) => bucket.units), [2, 3, 4])
})

test('year buckets preserve separate calendar years', () => {
  const buckets = bucketize([
    row('2025-12-31', 'A', 2),
    row('2026-01-01', 'A', 3),
  ], 'year')

  assert.deepEqual(buckets.map((bucket) => [bucket.bucket, bucket.units]), [
    ['2025', 2],
    ['2026', 3],
  ])
})

test('top parts collapse the remainder into Other without changing bucket sums', () => {
  const bucketed = bucketize([
    row('2026-07-01', 'A', '10'),
    row('2026-07-01', 'B', '6'),
    row('2026-07-01', 'C', '4'),
    row('2026-07-02', 'A', '1'),
    row('2026-07-02', 'B', '2'),
    row('2026-07-02', 'C', '8'),
  ], 'day')
  const stacked = topPartsWithOther(bucketed, 2)

  assert.deepEqual(stacked.parts, ['C', 'A', 'Other'])
  assert.deepEqual(stacked.buckets.map((bucket) => bucket.parts), [
    { A: 10, C: 4, Other: 6 },
    { A: 1, C: 8, Other: 2 },
  ])
  for (const bucket of stacked.buckets) {
    assert.equal(
      Object.values(bucket.parts).reduce((sum, units) => sum + units, 0),
      bucket.units
    )
  }
})

test('empty input produces empty buckets, parts, and summary totals', () => {
  assert.deepEqual(bucketize([], 'month'), [])
  assert.deepEqual(topPartsWithOther([]), { buckets: [], parts: [] })
  assert.deepEqual(summarize([], undefined, '2026-07-23'), {
    today: { units: 0, lines: 0, orders: 0, cost: 0, pricedOrders: 0 },
    thisWeek: { units: 0, lines: 0, orders: 0, cost: 0, pricedOrders: 0 },
    bySource: {},
    ltl: { today: 0, thisWeek: 0 },
    latestDay: null,
  })
})

test('range pre-seeds empty buckets so zero-shipment days stay on the axis', () => {
  const daily = [
    { day: '2026-07-21', source_system: 'S', part_number: 'A', service: 'FedEx Ground', units: 5, lines: 1, orders: 1 },
    { day: '2026-07-23', source_system: 'S', part_number: 'A', service: 'FedEx Ground', units: 7, lines: 1, orders: 1 },
  ]
  const buckets = bucketize(daily, 'day', [], { from: '2026-07-21', to: '2026-07-23' })
  assert.deepEqual(buckets.map((b) => b.bucket), ['2026-07-21', '2026-07-22', '2026-07-23'])
  assert.equal(buckets[1].units, 0)
  // Week bucketing over the same range collapses to one seeded bucket.
  const weekly = bucketize(daily, 'week', [], { from: '2026-07-21', to: '2026-07-23' })
  assert.deepEqual(weekly.map((b) => b.bucket), ['2026-07-20'])
})

test('all-NULL costs leave buckets unpriced — cost 0 with zero priced shipments, never a fake $0 total', () => {
  // One group with explicit SQL NULLs (SUM over an all-NULL group is NULL,
  // COUNT is 0) and one from a pre-cost RPC that omits the fields entirely.
  const daily: DailyRollupRow[] = [
    { day: '2026-07-22', source_system: 'SPS EDI (Home Depot)', part_number: 'A', service: 'FedEx Ground', units: 4, lines: '1', orders: '1', shipping_cost_usd: null, priced_orders: '0' },
    { day: '2026-07-22', source_system: 'SPS-Amazon', part_number: 'B', service: 'UPS Ground', units: 2, lines: '1', orders: '1' },
  ]

  const [bucket] = bucketize(daily, 'day')
  assert.equal(bucket.cost, 0)
  assert.equal(bucket.pricedOrders, 0)
  assert.equal(bucket.bySource['SPS EDI (Home Depot)'].pricedOrders, 0)
  assert.equal(bucket.bySource['SPS-Amazon'].pricedOrders, 0)
})

test('mixed NULL/priced groups sum only the priced costs and count them per source', () => {
  // supabase-js returns Postgres numeric columns as strings — costs arrive as
  // '2488.37', not 2488.37.
  const daily: DailyRollupRow[] = [
    { day: '2026-07-30', source_system: 'SPS EDI (Home Depot)', part_number: 'A', service: 'FedEx Ground', units: 10, lines: '3', orders: '1', shipping_cost_usd: '2488.37', priced_orders: '1' },
    { day: '2026-07-30', source_system: 'SPS-Amazon', part_number: 'B', service: 'UPS Ground', units: 2, lines: '1', orders: '1', shipping_cost_usd: '74.39', priced_orders: '1' },
    { day: '2026-07-30', source_system: 'SPS EDI (Home Depot)', part_number: 'C', service: 'LTL (set-aside)', units: 40, lines: '2', orders: '1', shipping_cost_usd: null, priced_orders: '0' },
  ]

  const [bucket] = bucketize(daily, 'day')
  assert.equal(Number(bucket.cost.toFixed(2)), 2562.76)
  assert.equal(bucket.pricedOrders, 2)
  assert.equal(bucket.bySource['SPS EDI (Home Depot)'].cost, 2488.37)
  assert.equal(bucket.bySource['SPS EDI (Home Depot)'].pricedOrders, 1)
  assert.equal(bucket.bySource['SPS-Amazon'].cost, 74.39)
  assert.equal(bucket.bySource['SPS-Amazon'].pricedOrders, 1)
})

test('multi-line shipment carries its cost exactly once — no double-count across part groups', () => {
  // One shipment (PO) spanning two parts: the DB writes shipping_cost_usd on
  // exactly one row per (run_id, po_number) — the lowest part_number line — so
  // only that line's rollup group carries the cost; the other group's SUM is
  // NULL. The bucket total must be the cost once, never per line.
  const daily: DailyRollupRow[] = [
    { day: '2026-07-30', source_system: 'SPS-Amazon', part_number: 'A', service: 'UPS Ground', units: 4, lines: '1', orders: '1', shipping_cost_usd: '74.39', priced_orders: '1' },
    { day: '2026-07-30', source_system: 'SPS-Amazon', part_number: 'B', service: 'UPS Ground', units: 2, lines: '2', orders: '1', shipping_cost_usd: null, priced_orders: '0' },
  ]
  const dailyOrders = [
    { day: '2026-07-30', source_system: 'SPS-Amazon', orders: 1 },
  ]

  const [bucket] = bucketize(daily, 'day', dailyOrders)
  assert.equal(bucket.cost, 74.39)
  assert.equal(bucket.pricedOrders, 1)
  assert.equal(bucket.orders, 1)
  assert.equal(bucket.bySource['SPS-Amazon'].cost, 74.39)
  assert.equal(bucket.bySource['SPS-Amazon'].pricedOrders, 1)

  const summary = summarize(daily, dailyOrders, '2026-07-30')
  assert.equal(summary.today.cost, 74.39)
  assert.equal(summary.today.pricedOrders, 1)
  assert.equal(summary.bySource['SPS-Amazon'].today.cost, 74.39)
})

test('daily-orders rows replace the part-grouped order counts (multi-part PO dedup)', () => {
  // One PO with two parts: the per-part rollup reports orders=1 twice; the
  // distinct pass reports 1. Units/lines still come from the part rows.
  const daily = [
    { day: '2026-07-22', source_system: 'SPS EDI (Home Depot)', part_number: 'A', service: 'FedEx Ground', units: 4, lines: 1, orders: 1 },
    { day: '2026-07-22', source_system: 'SPS EDI (Home Depot)', part_number: 'B', service: 'FedEx Ground', units: 2, lines: 1, orders: 1 },
  ]
  const dailyOrders = [
    { day: '2026-07-22', source_system: 'SPS EDI (Home Depot)', orders: 1 },
  ]

  const [bucket] = bucketize(daily, 'day', dailyOrders)
  assert.equal(bucket.orders, 1)
  assert.equal(bucket.units, 6)
  assert.equal(bucket.lines, 2)
  assert.equal(bucket.bySource['SPS EDI (Home Depot)'].orders, 1)

  const summary = summarize(daily, dailyOrders, '2026-07-22')
  assert.equal(summary.today.orders, 1)
  assert.equal(summary.today.units, 6)
  assert.equal(summary.bySource['SPS EDI (Home Depot)'].today.orders, 1)

  // Without the distinct rows, the legacy (over-counting) fallback still works.
  const fallback = summarize(daily, undefined, '2026-07-22')
  assert.equal(fallback.today.orders, 2)
})
