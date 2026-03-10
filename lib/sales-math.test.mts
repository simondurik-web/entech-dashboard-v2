import test from 'node:test'
import assert from 'node:assert/strict'

import { getOrderCost, getOrderMargin, getOrderPL, getProfitPerPart } from './sales-math.ts'

function assertClose(actual: number, expected: number, epsilon: number = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`)
}

test('qty-aware costs make a 2.60 vs 2.84 order a loss', () => {
  const order = {
    qty: 2500,
    unitPrice: 2.60,
    revenue: 2500 * 2.60,
    variableCost: 2.84,
    totalCost: 2.84,
  }

  assert.equal(getOrderCost(order), 7100)
  assert.equal(getOrderPL(order), -600)
  assert.ok(getOrderMargin(order) < 0)
  assertClose(getProfitPerPart(order), -0.24)
})

test('2.87 vs 2.84 stays a small positive margin, not near 100%', () => {
  const order = {
    qty: 2500,
    unitPrice: 2.87,
    revenue: 2500 * 2.87,
    variableCost: 2.84,
    totalCost: 2.84,
  }

  assert.equal(getOrderPL(order), 75)
  assert.ok(getOrderMargin(order) > 0.9 && getOrderMargin(order) < 1.1)
  assertClose(getProfitPerPart(order), 0.03)
})
