import type { IncomeStatementMonth, LineItem } from './types'

type Section = 'income' | 'cogs' | 'expense' | 'otherExpense'

// Section start anchors. Match by trimmed exact string.
const SECTION_STARTS: Record<string, Section> = {
  'Income': 'income',
  'Cost Of Sales': 'cogs',
  'Expense': 'expense',
  'Other Expense': 'otherExpense',
}

// Section total anchors. The label *starts* with these (trailing whitespace
// or extra description after dash is tolerated).
const SECTION_TOTALS: Array<{ prefix: string; section: Section; total: keyof IncomeStatementMonth['totals'] }> = [
  { prefix: 'Total - Income',        section: 'income',       total: 'income' },
  { prefix: 'Total - Cost Of Sales', section: 'cogs',         total: 'cogs' },
  { prefix: 'Total - Expense',       section: 'expense',      total: 'expense' },
  { prefix: 'Total - Other Expense', section: 'otherExpense', total: 'otherExpense' },
]

// Header / group rows we always skip in line-item mode (they have no amount).
const GROUP_HEADERS = new Set([
  'Ordinary Income/Expense',
  'Other Income and Expenses',
])

// Bottom-of-sheet derived figures (Excel computed them, we just pluck them).
const DERIVED_LABELS: Record<string, keyof IncomeStatementMonth['derived']> = {
  'Gross Profit':         'grossProfit',
  'Net Ordinary Income':  'netOrdinaryIncome',
  'Net Other Income':     'netOtherIncome',
  'Net Income':           'netIncome',
  'Interest':             'interest',
  'Depreciation':         'depreciation',
  'EBITDA':               'ebitda',
}

// Parse a "Mmm yy" tab label ("Jan 26") into ISO month ("2026-01").
const MONTH_ABBR: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export function tabLabelToIso(label: string): string {
  const m = label.trim().toLowerCase().match(/^([a-z]{3})\s+(\d{2})$/)
  if (!m) return label
  const month = MONTH_ABBR[m[1]]
  if (!month) return label
  // "26" → "2026". Two-digit years map into 2000-2099.
  const year = 2000 + parseInt(m[2], 10)
  return `${year}-${month}`
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/,/g, ''))
    if (isFinite(n)) return n
  }
  return null
}

export function parseMonthRows(label: string, rows: unknown[][]): IncomeStatementMonth {
  const month: IncomeStatementMonth = {
    label,
    monthIso: tabLabelToIso(label),
    income: [],
    cogs: [],
    expense: [],
    otherExpense: [],
    totals: { income: 0, cogs: 0, expense: 0, otherExpense: 0 },
    derived: {
      grossProfit: 0, netOrdinaryIncome: 0, netOtherIncome: 0, netIncome: 0,
      interest: 0, depreciation: 0, ebitda: 0,
    },
  }

  let section: Section | null = null

  for (const row of rows) {
    if (!row || row.length === 0) continue
    const rawLabel = row[0]
    if (typeof rawLabel !== 'string') continue
    const labelTrim = rawLabel.trim()
    if (!labelTrim) continue

    // Skip the title/header band (rows 1-7 typically).
    if (labelTrim === 'Entech Inc.' ||
        labelTrim.startsWith('Parent Company') ||
        labelTrim.includes('Income Statement') ||
        labelTrim === 'Financial Row') {
      continue
    }
    if (GROUP_HEADERS.has(labelTrim)) {
      section = null
      continue
    }

    // Section total — closes the section + records the value.
    const totalMatch = SECTION_TOTALS.find((t) => labelTrim.startsWith(t.prefix))
    if (totalMatch) {
      const v = toNumber(row[1])
      if (v !== null) month.totals[totalMatch.total] = v
      section = null
      continue
    }

    // Section start anchor — switches mode but contributes no line item.
    if (labelTrim in SECTION_STARTS) {
      section = SECTION_STARTS[labelTrim]
      continue
    }

    // Bottom-of-sheet derived figure.
    if (labelTrim in DERIVED_LABELS) {
      const v = toNumber(row[1])
      if (v !== null) month.derived[DERIVED_LABELS[labelTrim]] = v
      continue
    }

    // Otherwise: if we're inside a section and the row has a numeric amount,
    // it's a line item.
    if (section) {
      const v = toNumber(row[1])
      if (v === null) continue
      month[section].push({
        account: labelTrim,
        amount: v,
        percentOfRevenue: 0,  // filled in below
      })
    }
  }

  // Derive % of revenue for every line item. If income total is 0 (an empty
  // month), leave the percentages at 0 rather than divide-by-zero.
  const revenue = month.totals.income
  const fill = (items: LineItem[]) => {
    for (const it of items) {
      it.percentOfRevenue = revenue !== 0 ? it.amount / revenue : 0
    }
  }
  fill(month.income)
  fill(month.cogs)
  fill(month.expense)
  fill(month.otherExpense)

  return month
}
