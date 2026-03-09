export interface SalesMathInputs {
  revenue: number
  variableCost: number
  totalCost: number
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

export function getDisplayTotalCost(totalCost: number, variableCost: number): number {
  return totalCost || variableCost
}

export function calculateSalesMath({
  revenue,
  variableCost,
  totalCost,
}: SalesMathInputs): SalesMathResult {
  const displayTotalCost = getDisplayTotalCost(totalCost, variableCost)
  const variableProfit = revenue - variableCost
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
    (sum, order) => sum + getDisplayTotalCost(order.totalCost, order.variableCost),
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
