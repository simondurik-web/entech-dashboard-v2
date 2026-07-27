import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyCategory,
  filterByCategory,
  visibleCategoryKeys,
  DEFAULT_CATEGORIES,
} from './category.ts'

test('Technoflex is carved out of Molding by customer name', () => {
  // Every Technoflex row carries category="Molding " in the DB — 1006 of them as of
  // 2026-07-26, 41% of all Molding. The whole point of the chip is separating them.
  assert.equal(classifyCategory({ customer: 'Technoflex Intl Inc.', category: 'Molding ' }), 'technoflex')
})

test('Technoflex match survives case, trailing period and trailing space', () => {
  for (const name of [
    'Technoflex Intl Inc.',
    'Technoflex Intl Inc',
    'TECHNOFLEX INTL INC.',
    'technoflex intl inc',
    'Technoflex Intl Inc. ',
    '  Technoflex  Intl  Inc.  ',
  ]) {
    assert.equal(classifyCategory({ customer: name, category: 'Molding ' }), 'technoflex', name)
  }
})

test('a customer merely CONTAINING "techno" is not Technoflex', () => {
  // Regression guard: 'Hypervac Technologies Inc' is a live Roll Tech customer. A
  // substring match on 'techno' would misfile it and quietly inflate Technoflex.
  assert.equal(
    classifyCategory({ customer: 'Hypervac Technologies Inc', category: 'Roll tech' }),
    'rolltech'
  )
})

test('dirty live category values still classify', () => {
  // These are the REAL literals in dashboard_orders, not tidied-up examples:
  // 'Molding ' has a trailing space (2427 rows), 'Roll tech' a lowercase t (906).
  assert.equal(classifyCategory({ customer: 'Homecare Products, Inc.', category: 'Molding ' }), 'molding')
  assert.equal(classifyCategory({ customer: 'Martin Wheel Division', category: 'Roll tech' }), 'rolltech')
  assert.equal(classifyCategory({ customer: 'Origen RV Accessories', category: 'Snap Pad' }), 'snappad')
})

test('unclassifiable rows bucket as other, never silently as a real category', () => {
  assert.equal(classifyCategory({ customer: 'X', category: null }), 'other')
  assert.equal(classifyCategory({ customer: 'X', category: '' }), 'other')
  assert.equal(
    classifyCategory({ customer: 'X', category: 'Part number missing in item reference data' }),
    'other'
  )
})

test('"All" is a bypass so uncategorized rows stay visible', () => {
  // 45 live rows classify as `other`. They are visible under All today; implementing
  // All as "the union of the four buckets" would have silently hidden them.
  const rows = [
    { customer: 'A', category: null },
    { customer: 'B', category: 'Part number missing in item reference data' },
    { customer: 'Technoflex Intl Inc.', category: 'Molding ' },
  ]
  assert.equal(filterByCategory(rows, DEFAULT_CATEGORIES).length, 3)
  assert.equal(filterByCategory(rows, []).length, 3)
  // ...but an explicit partial selection legitimately excludes them.
  assert.equal(filterByCategory(rows, ['rolltech', 'molding', 'snappad']).length, 0)
})

test('Molding excludes Technoflex; ticking both restores the old combined view', () => {
  const rows = [
    { customer: 'Technoflex Intl Inc.', category: 'Molding ' },
    { customer: 'Homecare Products, Inc.', category: 'Molding ' },
  ]
  assert.deepEqual(filterByCategory(rows, ['molding']).map((r) => r.customer), [
    'Homecare Products, Inc.',
  ])
  assert.equal(filterByCategory(rows, ['molding', 'technoflex']).length, 2)
})

test('a page that hides the Technoflex chip still detects its own All state', () => {
  // material-requirements renders 3 chips (BOM aggregates have no customer). If its
  // All state were compared against the 4-key total it would never bypass, and the
  // `other` rows would vanish.
  const keys = visibleCategoryKeys(false)
  assert.deepEqual([...keys], ['rolltech', 'molding', 'snappad'])
  const rows = [{ customer: 'A', category: null }]
  assert.equal(filterByCategory(rows, keys, keys.length).length, 1)
})
