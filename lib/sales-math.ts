export interface SalesMathInputs {
  qty?: number
  revenue: number
  variableCost: number
  totalCost: number
  unitPrice?: number
}

export interface SalesMathResult {
  variableProfit: number
  totalProfit: number
  variableMarginPct: number
  totalMarginPct: number
}

export interface SalesSummaryLike extends SalesMathResult {
  totalRevenue: number
  totalCosts: number
  totalPL: number
  avgMargin: number
  orderCount: number
  shippedPL: number
  shippedCount: number
  forecastPL: number
  pendingCount: number
}

export interface SalesOrderLike extends SalesMathInputs, SalesMathResult {
  status: string
}

function toMarginPct(revenue: number, profit: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0
}

export function getDisplayTotalCost(totalCost: number, variableCost: number, qty: number = 1): number {
  const perUnitCost = totalCost || variableCost
  return qty > 0 ? perUnitCost * qty : perUnitCost
}

export function isNoOpSalesMathRow({
  revenue,
  variableCost,
  totalCost,
}: SalesMathInputs): boolean {
  return revenue === 0 && variableCost === 0 && totalCost === 0
}

export function calculateSalesMath({
  qty = 1,
  revenue,
  variableCost,
  totalCost,
}: SalesMathInputs): SalesMathResult {
  const variableOrderCost = getDisplayTotalCost(variableCost, variableCost, qty)
  const displayTotalCost = getDisplayTotalCost(totalCost, variableCost, qty)
  const variableProfit = revenue - variableOrderCost
  const totalProfit = revenue - displayTotalCost

  return {
    variableProfit,
    totalProfit,
    variableMarginPct: toMarginPct(revenue, variableProfit),
    totalMarginPct: toMarginPct(revenue, totalProfit),
  }
}

export function summarizeSalesOrders<T extends SalesOrderLike>(orders: T[]): SalesSummaryLike {
  const totalRevenue = orders.reduce((sum, order) => sum + order.revenue, 0)
  const totalCosts = orders.reduce(
    (sum, order) => sum + getDisplayTotalCost(order.totalCost, order.variableCost, order.qty),
    0
  )
  const variableProfit = orders.reduce((sum, order) => sum + order.variableProfit, 0)
  const totalProfit = orders.reduce((sum, order) => sum + order.totalProfit, 0)
  const shippedOrders = orders.filter((order) => order.status === 'shipped')
  const shippedTotalProfit = shippedOrders.reduce((sum, order) => sum + order.totalProfit, 0)
  const shippedCount = shippedOrders.length
  const forecastTotalProfit = totalProfit - shippedTotalProfit
  const pendingCount = orders.length - shippedCount

  return {
    totalRevenue,
    totalCosts,
    totalPL: totalProfit,
    avgMargin: toMarginPct(totalRevenue, totalProfit),
    variableProfit,
    totalProfit,
    variableMarginPct: toMarginPct(totalRevenue, variableProfit),
    totalMarginPct: toMarginPct(totalRevenue, totalProfit),
    orderCount: orders.length,
    shippedPL: shippedTotalProfit,
    shippedCount,
    forecastPL: forecastTotalProfit,
    pendingCount,
  }
}

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
