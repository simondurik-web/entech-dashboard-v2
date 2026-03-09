import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateSalesMath } from './sales-math.ts'

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
