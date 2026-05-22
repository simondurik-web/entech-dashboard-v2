import 'server-only'

import { getSheetsClient } from '@/lib/google-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseMonthRows, tabLabelToIso } from './parser'
import type { IncomeStatementMonth, IncomeStatementResponse } from './types'

const INCOME_STATEMENT_SHEET_ID =
  process.env.INCOME_STATEMENT_SHEET_ID || '1lhFbJc8_Gk7RnCK0SR1NvyXqeBwJtfP0BmlCkVrfP_E'

// Light per-process cache. Phil/Simon will hit this page a few times in a
// session and the sheet doesn't change often (one new tab per month).
let cache: { at: number; payload: IncomeStatementResponse } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000

export async function fetchIncomeStatement(opts?: { skipCache?: boolean }): Promise<IncomeStatementResponse> {
  if (!opts?.skipCache && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.payload
  }

  const sheets = getSheetsClient()

  // 1) List tabs.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: INCOME_STATEMENT_SHEET_ID })
  const tabNames = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean)

  // 2) Batch-fetch A:B for every tab in one call.
  const ranges = tabNames.map((t) => `'${t}'!A1:B200`)
  const batch = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: INCOME_STATEMENT_SHEET_ID,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })

  const months: IncomeStatementMonth[] = []
  for (let i = 0; i < tabNames.length; i++) {
    const rows = (batch.data.valueRanges?.[i]?.values || []) as unknown[][]
    if (rows.length === 0) continue
    const parsed = parseMonthRows(tabNames[i], rows)
    // Drop tabs with no real data (a future placeholder tab with just headers).
    if (parsed.totals.income === 0 && parsed.income.length === 0) continue
    months.push(parsed)
  }

  // Sort chronologically (parser-derived ISO key).
  months.sort((a, b) => {
    const aIso = tabLabelToIso(a.label)
    const bIso = tabLabelToIso(b.label)
    return aIso.localeCompare(bIso)
  })

  const payload: IncomeStatementResponse = {
    months,
    fetchedAt: new Date().toISOString(),
  }
  cache = { at: Date.now(), payload }

  // Mirror into Supabase so Phil can SQL it. Best-effort — a sync failure
  // shouldn't break the page render.
  syncToSupabase(months).catch((e) => {
    console.error('[income-statement] Supabase sync failed:', e instanceof Error ? e.message : e)
  })

  return payload
}

async function syncToSupabase(months: IncomeStatementMonth[]) {
  if (months.length === 0) return
  const rows = months.map((m) => {
    const rev = m.totals.income
    return {
      month_iso: m.monthIso,
      label: m.label,
      revenue: m.totals.income,
      cogs: m.totals.cogs,
      expense: m.totals.expense,
      other_expense: m.totals.otherExpense,
      gross_profit: m.derived.grossProfit,
      net_ordinary_income: m.derived.netOrdinaryIncome,
      net_other_income: m.derived.netOtherIncome,
      net_income: m.derived.netIncome,
      interest: m.derived.interest,
      depreciation: m.derived.depreciation,
      ebitda: m.derived.ebitda,
      gross_margin_pct:  rev !== 0 ? m.derived.grossProfit / rev : null,
      net_margin_pct:    rev !== 0 ? m.derived.netIncome   / rev : null,
      ebitda_margin_pct: rev !== 0 ? m.derived.ebitda      / rev : null,
      line_items: {
        income: m.income,
        cogs: m.cogs,
        expense: m.expense,
        otherExpense: m.otherExpense,
      },
      updated_at: new Date().toISOString(),
    }
  })
  const { error } = await supabaseAdmin
    .from('income_statement_months')
    .upsert(rows, { onConflict: 'month_iso' })
  if (error) throw error
}
