// Income Statement types.
//
// One month tab → one IncomeStatementMonth. The sheet's row order varies tab
// to tab, so the parser keys off section anchor labels (`Income`, `Cost Of
// Sales`, `Expense`, `Other Expense` + the matching `Total - ...` rows)
// rather than fixed row indices.

export type LineItem = {
  account: string   // raw label from the sheet ("413000 - Sales - Compression Molding")
  amount: number
  // % of total income — computed by the parser, not read from column C.
  percentOfRevenue: number
}

export type IncomeStatementMonth = {
  // Tab name from the sheet, e.g. "Jan 26"
  label: string
  // Normalized YYYY-MM key for sorting / comparison ("2026-01")
  monthIso: string

  income: LineItem[]
  cogs: LineItem[]
  expense: LineItem[]
  otherExpense: LineItem[]

  totals: {
    income: number          // "Total - Income"
    cogs: number            // "Total - Cost Of Sales"
    expense: number         // "Total - Expense"
    otherExpense: number    // "Total - Other Expense" (often missing → 0)
  }

  derived: {
    grossProfit: number
    netOrdinaryIncome: number
    netOtherIncome: number
    netIncome: number
    interest: number
    depreciation: number
    ebitda: number
  }
}

export type IncomeStatementResponse = {
  months: IncomeStatementMonth[]
  fetchedAt: string
}
