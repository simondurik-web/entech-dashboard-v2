import assert from 'node:assert/strict'
import test from 'node:test'

import { computeOrderAllocations, allocationKey } from './component-availability.ts'
import type { Order, InventoryItem } from './google-sheets-shared.ts'

// Minimal builders — only the fields the allocator reads.
let lineSeq = 4000
function order(over: Partial<Order>): Order {
  lineSeq += 1
  return {
    line: String(lineSeq),
    ifNumber: `IF${lineSeq}`,
    category: 'Roll tech',
    internalStatus: 'pending',
    ifStatus: '',
    shippedDate: '',
    partNumber: '',
    tire: '',
    hub: '',
    orderQty: 0,
    fusionInventory: 0,
    daysUntilDue: 30,
    ...over,
  } as unknown as Order
}

function inv(partNumber: string, inStock: number, minimum = 0): InventoryItem {
  return { partNumber, inStock, minimum, onHand: inStock, committed: 0 } as unknown as InventoryItem
}

test('tire pool: first order in priority line goes green, later ones red (Simon 308 case)', () => {
  const first = order({ tire: '308', orderQty: 8448, priorityOverride: 'P3', daysUntilDue: 21 })
  const second = order({ tire: '308', orderQty: 8448, priorityOverride: 'P4', daysUntilDue: 56 })
  const small = order({ tire: '308', orderQty: 200, priorityOverride: 'P4', daysUntilDue: 70 })
  const alloc = computeOrderAllocations([second, small, first], [inv('308', 11640, 9000)])
  assert.equal(alloc.get(allocationKey(first))?.tireOk, true)   // 11,640 covers 8,448
  assert.equal(alloc.get(allocationKey(second))?.tireOk, false) // 3,192 left < 8,448
  assert.equal(alloc.get(allocationKey(small))?.tireOk, true)   // shortfall order takes nothing; 3,192 covers 200
})

test('minimum buffer does not block a fulfillable order', () => {
  const o = order({ tire: 'T1', orderQty: 100, priorityOverride: 'P1' })
  const alloc = computeOrderAllocations([o], [inv('T1', 150, 9000)])
  assert.equal(alloc.get(allocationKey(o))?.tireOk, true)
})

test('due date breaks priority ties', () => {
  const later = order({ tire: 'T2', orderQty: 80, priorityOverride: 'P2', daysUntilDue: 40 })
  const sooner = order({ tire: 'T2', orderQty: 80, priorityOverride: 'P2', daysUntilDue: 5 })
  const alloc = computeOrderAllocations([later, sooner], [inv('T2', 100)])
  assert.equal(alloc.get(allocationKey(sooner))?.tireOk, true)
  assert.equal(alloc.get(allocationKey(later))?.tireOk, false)
})

test('urgent override outranks P1', () => {
  const p1 = order({ tire: 'T3', orderQty: 80, priorityOverride: 'P1', daysUntilDue: 1 })
  const urgent = order({ tire: 'T3', orderQty: 80, urgentOverride: true, daysUntilDue: 60 })
  const alloc = computeOrderAllocations([p1, urgent], [inv('T3', 100)])
  assert.equal(alloc.get(allocationKey(urgent))?.tireOk, true)
  assert.equal(alloc.get(allocationKey(p1))?.tireOk, false)
})

test('hub and tire pools are independent', () => {
  const o = order({ tire: 'T4', hub: 'H4', orderQty: 50, priorityOverride: 'P1' })
  const alloc = computeOrderAllocations([o], [inv('T4', 100), inv('H4', 10)])
  assert.equal(alloc.get(allocationKey(o))?.tireOk, true)
  assert.equal(alloc.get(allocationKey(o))?.hubOk, false)
})

test('finished-part fusion pool allocates across molding orders of the same part', () => {
  const a = order({ category: 'Molding', partNumber: 'THRESH-2.0', orderQty: 120, fusionInventory: 150, priorityOverride: 'P2', daysUntilDue: 3 })
  const b = order({ category: 'Molding', partNumber: 'THRESH-2.0', orderQty: 120, fusionInventory: 150, priorityOverride: 'P2', daysUntilDue: 9 })
  const alloc = computeOrderAllocations([b, a], [])
  assert.equal(alloc.get(allocationKey(a))?.partOk, true)  // 150 covers first 120
  assert.equal(alloc.get(allocationKey(b))?.partOk, false) // 30 left
})

test('stockOk allocates ERPNext available stock per order (canPackage)', () => {
  const a = order({ partNumber: '688.246.1612', orderQty: 5000, priorityOverride: 'P1' })
  const b = order({ partNumber: '688.246.1612', orderQty: 300, priorityOverride: 'P4' })
  const alloc = computeOrderAllocations([a, b], [inv('688.246.1612', 1250)])
  assert.equal(alloc.get(allocationKey(a))?.stockOk, false)
  assert.equal(alloc.get(allocationKey(b))?.stockOk, true)
})

test('due-today order (daysUntilDue nulled by the data layer) still outranks later dates', () => {
  const today = new Date().toISOString().slice(0, 10)
  const dueToday = order({ tire: 'T6', orderQty: 80, priorityOverride: 'P2', daysUntilDue: null as unknown as number, requestedDate: today })
  const nextWeek = order({ tire: 'T6', orderQty: 80, priorityOverride: 'P2', daysUntilDue: 7 })
  const alloc = computeOrderAllocations([nextWeek, dueToday], [inv('T6', 100)])
  assert.equal(alloc.get(allocationKey(dueToday))?.tireOk, true)
  assert.equal(alloc.get(allocationKey(nextWeek))?.tireOk, false)
})

test('negative qty never tops a pool back up', () => {
  const bad = order({ tire: 'T7', orderQty: -500, priorityOverride: 'P1' })
  const real = order({ tire: 'T7', orderQty: 150, priorityOverride: 'P2' })
  const alloc = computeOrderAllocations([bad, real], [inv('T7', 100)])
  assert.equal(alloc.get(allocationKey(real))?.tireOk, false) // pool stays 100, not 600
})

test('shipped and staged orders take nothing from the pools', () => {
  const shipped = order({ tire: 'T5', orderQty: 90, priorityOverride: 'P1', shippedDate: '2026-07-01' })
  const staged = order({ tire: 'T5', orderQty: 90, priorityOverride: 'P1', internalStatus: 'staged' })
  const open = order({ tire: 'T5', orderQty: 90, priorityOverride: 'P4' })
  const alloc = computeOrderAllocations([shipped, staged, open], [inv('T5', 100)])
  assert.equal(alloc.get(allocationKey(open))?.tireOk, true)
  assert.equal(alloc.has(allocationKey(shipped)), false)
  assert.equal(alloc.has(allocationKey(staged)), false)
})
