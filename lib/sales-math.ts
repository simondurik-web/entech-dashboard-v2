export interface SalesMathInput {
  qty: number
  revenue: number
  variableCost: number
  totalCost: number
  unitPrice?: number
}

export function getPerUnitCost(order: SalesMathInput): number {
  return order.totalCost || order.variableCost || 0
}

export function getUnitPrice(order: SalesMathInput): number {
  if (order.unitPrice && order.unitPrice > 0) return order.unitPrice
  return order.qty > 0 ? order.revenue / order.qty : 0
}

export function getOrderCost(order: SalesMathInput): number {
  const perUnitCost = getPerUnitCost(order)
  return order.qty > 0 ? perUnitCost * order.qty : perUnitCost
}

export function getOrderPL(order: SalesMathInput): number {
  return order.revenue - getOrderCost(order)
}

export function getOrderMargin(order: SalesMathInput): number {
  return order.revenue > 0 ? (getOrderPL(order) / order.revenue) * 100 : 0
}

export function getProfitPerPart(order: SalesMathInput): number {
  return getUnitPrice(order) - getPerUnitCost(order)
}
