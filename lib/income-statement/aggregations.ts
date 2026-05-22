import type { IncomeStatementMonth } from './types'

// Quarterly / yearly aggregation. Sums the section totals + derived
// figures across the constituent months. EBITDA / Gross Profit are
// summed too (additive across months — same units, same period basis).

export type AggregatedPeriod = {
  key: string             // "2026-Q1" or "2026"
  label: string           // "Q1 2026" or "2026"
  monthCount: number
  monthLabels: string[]   // ["Jan 26", "Feb 26", "Mar 26"]
  totals: IncomeStatementMonth['totals']
  derived: IncomeStatementMonth['derived']
}

// Returns chronological-ordered periods.
export function aggregateByQuarter(months: IncomeStatementMonth[]): AggregatedPeriod[] {
  const buckets = new Map<string, IncomeStatementMonth[]>()
  for (const m of months) {
    const [year, mm] = m.monthIso.split('-')
    if (!year || !mm) continue
    const q = Math.floor((parseInt(mm, 10) - 1) / 3) + 1
    const key = `${year}-Q${q}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(m)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ms]) => ({
      key,
      label: `Q${key.slice(-1)} ${key.slice(0, 4)}`,
      monthCount: ms.length,
      monthLabels: ms.map((m) => m.label),
      totals: sumTotals(ms),
      derived: sumDerived(ms),
    }))
}

export function aggregateByYear(months: IncomeStatementMonth[]): AggregatedPeriod[] {
  const buckets = new Map<string, IncomeStatementMonth[]>()
  for (const m of months) {
    const year = m.monthIso.slice(0, 4)
    if (!year) continue
    if (!buckets.has(year)) buckets.set(year, [])
    buckets.get(year)!.push(m)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, ms]) => ({
      key: year,
      label: year,
      monthCount: ms.length,
      monthLabels: ms.map((m) => m.label),
      totals: sumTotals(ms),
      derived: sumDerived(ms),
    }))
}

function sumTotals(ms: IncomeStatementMonth[]) {
  return {
    income: ms.reduce((a, m) => a + m.totals.income, 0),
    cogs: ms.reduce((a, m) => a + m.totals.cogs, 0),
    expense: ms.reduce((a, m) => a + m.totals.expense, 0),
    otherExpense: ms.reduce((a, m) => a + m.totals.otherExpense, 0),
  }
}

function sumDerived(ms: IncomeStatementMonth[]) {
  return {
    grossProfit: ms.reduce((a, m) => a + m.derived.grossProfit, 0),
    netOrdinaryIncome: ms.reduce((a, m) => a + m.derived.netOrdinaryIncome, 0),
    netOtherIncome: ms.reduce((a, m) => a + m.derived.netOtherIncome, 0),
    netIncome: ms.reduce((a, m) => a + m.derived.netIncome, 0),
    interest: ms.reduce((a, m) => a + m.derived.interest, 0),
    depreciation: ms.reduce((a, m) => a + m.derived.depreciation, 0),
    ebitda: ms.reduce((a, m) => a + m.derived.ebitda, 0),
  }
}
