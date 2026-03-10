import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateSalesMath, isNoOpSalesMathRow, summarizeSalesOrders } from './sales-math.ts'

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
