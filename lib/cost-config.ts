// Configurable overhead percentages and profit target
// These match the BOM sheet formulas
export const COST_CONFIG = {
  overheadRate: 0.0191,
  adminExpenseRate: 0.1128,
  depreciationRate: 0.1055,
  repairsSuppliesRate: 0.0658,
  profitTarget: 0.20,
} as const

export type ContributionLevel = 'Critical Loss' | 'Marginal Coverage' | 'Net Profitable' | 'Target Achieved'

export function computeContributionLevel(
  lowestPrice: number | null,
  variableCost: number | null,
  totalCost: number | null,
  salesTarget: number | null
): ContributionLevel | null {
  if (!lowestPrice || lowestPrice <= 0) return null
  if (!variableCost || !totalCost || !salesTarget) return null
  if (lowestPrice < variableCost) return 'Critical Loss'
  if (lowestPrice < totalCost) return 'Marginal Coverage'
  if (lowestPrice < salesTarget) return 'Net Profitable'
  return 'Target Achieved'
}

export function getContributionColor(level: string | null): string {
  switch (level) {
    case 'Critical Loss': return 'bg-red-500/20 text-red-400 border-red-500/30'
    case 'Marginal Coverage': return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    case 'Net Profitable': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'Target Achieved': return 'bg-green-500/20 text-green-400 border-green-500/30'
    default: return 'bg-muted text-muted-foreground'
  }
}
