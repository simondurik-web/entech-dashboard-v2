import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateSalesMath, getOrderCost, getOrderMargin, getOrderPL, getProfitPerPart, isNoOpSalesMathRow, summarizeSalesOrders } from './sales-math.ts'

function assertClose(actual: number, expected: number, epsilon: number = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`)
}

test('total-basis profit and margin go negative when revenue is below total cost but above variable cost', () => {
  const result = calculateSalesMath({
    revenue: 100,
    variableCost: 80,
    totalCost: 120,
  })

  assert.equal(result.variableProfit, 20)
  assert.equal(result.totalProfit, -20)
  assert.equal(result.variableMarginPct, 20)
  assert.equal(result.totalMarginPct, -20)
})

test('zero-revenue rows with positive total cost are included and keep total-basis loss visible', () => {
  const revenue = 0
  const variableCost = 0
  const totalCost = 50

  assert.equal(isNoOpSalesMathRow({ revenue, variableCost, totalCost }), false)

  const salesMath = calculateSalesMath({ revenue, variableCost, totalCost })
  const summary = summarizeSalesOrders([
    {
      revenue,
      variableCost,
      totalCost,
      status: 'pending',
      ...salesMath,
    },
  ])

  assert.equal(summary.orderCount, 1)
  assert.equal(summary.totalProfit, -50)
  assert.equal(summary.totalPL, -50)
})

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

  const salesMath = calculateSalesMath(order)
  assert.equal(salesMath.totalProfit, -600)
  assert.ok(salesMath.totalMarginPct < 0)
})

test('2.87 vs 2.84 stays a small positive margin, not near 100%', () => {
  const order = {
    qty: 2500,
    unitPrice: 2.87,
    revenue: 2500 * 2.87,
    variableCost: 2.84,
    totalCost: 2.84,
  }

  assert.equal(getOrderCost(order), 7100)
  assert.equal(getOrderPL(order), 75)
  assert.ok(getOrderMargin(order) > 0.9 && getOrderMargin(order) < 1.1)
  assertClose(getProfitPerPart(order), 0.03)

  const salesMath = calculateSalesMath(order)
  assert.equal(salesMath.totalProfit, 75)
  assert.ok(salesMath.totalMarginPct > 0.9 && salesMath.totalMarginPct < 1.1)
})
