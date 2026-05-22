'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, LabelList, LineChart, Line, Legend,
} from 'recharts'
import { useI18n } from '@/lib/i18n'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { RefreshCcw, ChevronDown, ChevronRight, FileBarChart, Download, FileSpreadsheet, FileText } from 'lucide-react'
import type { IncomeStatementResponse, IncomeStatementMonth, LineItem } from '@/lib/income-statement/types'
import { aggregateByQuarter, aggregateByYear, type AggregatedPeriod } from '@/lib/income-statement/aggregations'
import {
  exportMonthXlsx, exportMonthPdf,
  exportTrendXlsx, exportTrendPdf,
  exportPeriodsXlsx, exportPeriodsPdf,
} from '@/lib/income-statement/exporters'

type ViewMode = 'month' | 'trend' | 'quarterly' | 'yearly'

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const currencyFmtSigned = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, signDisplay: 'auto' })
const percentFmt = new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })

function classNames(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(' ')
}

export default function IncomeStatementPage() {
  const { t } = useI18n()
  const [data, setData] = useState<IncomeStatementResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('month')
  const [selected, setSelected] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true)
      const r = await fetch(`/api/income-statement${refresh ? '?refresh=1' : ''}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const payload = (await r.json()) as IncomeStatementResponse
      setData(payload)
      if (!selected && payload.months.length > 0) {
        setSelected(payload.months[payload.months.length - 1].monthIso)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { load(false) }, [])

  const month = useMemo<IncomeStatementMonth | null>(() => {
    if (!data || !selected) return null
    return data.months.find((m) => m.monthIso === selected) ?? null
  }, [data, selected])

  const quarters = useMemo(() => (data ? aggregateByQuarter(data.months) : []), [data])
  const years = useMemo(() => (data ? aggregateByYear(data.months) : []), [data])

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">{t('incomeStatement.title')}</h1>
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {t('incomeStatement.loadError')}: {error}
        </div>
      </div>
    )
  }
  if (!data) return <div className="p-6 space-y-4"><h1 className="text-2xl font-bold">{t('incomeStatement.title')}</h1><TableSkeleton rows={8} /></div>
  if (data.months.length === 0) return <div className="p-6"><h1 className="text-2xl font-bold mb-2">{t('incomeStatement.title')}</h1><p className="text-sm text-gray-600 dark:text-gray-400">{t('incomeStatement.noMonths')}</p></div>

  const handleExport = (format: 'xlsx' | 'pdf') => {
    if (view === 'month' && month) {
      format === 'xlsx' ? exportMonthXlsx(month) : exportMonthPdf(month)
    } else if (view === 'trend') {
      format === 'xlsx' ? exportTrendXlsx(data.months) : exportTrendPdf(data.months)
    } else if (view === 'quarterly') {
      format === 'xlsx'
        ? exportPeriodsXlsx(quarters, 'income-statement-quarterly.xlsx', 'Quarterly')
        : exportPeriodsPdf(quarters, t('incomeStatement.quarterly'), 'income-statement-quarterly.pdf')
    } else if (view === 'yearly') {
      format === 'xlsx'
        ? exportPeriodsXlsx(years, 'income-statement-yearly.xlsx', 'Yearly')
        : exportPeriodsPdf(years, t('incomeStatement.yearly'), 'income-statement-yearly.pdf')
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileBarChart className="size-6 text-blue-600 dark:text-blue-400" />
              {t('incomeStatement.title')}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('incomeStatement.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {view === 'month' && (
              <select
                value={selected ?? ''}
                onChange={(e) => setSelected(e.target.value)}
                className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium"
              >
                {data.months.map((m) => (<option key={m.monthIso} value={m.monthIso}>{m.label}</option>))}
              </select>
            )}
            <button
              onClick={() => handleExport('xlsx')}
              className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5"
              title={t('incomeStatement.exportXlsx')}
            >
              <FileSpreadsheet className="size-3.5" />
              <span className="hidden sm:inline">{t('incomeStatement.exportXlsx')}</span>
            </button>
            <button
              onClick={() => handleExport('pdf')}
              className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1.5"
              title={t('incomeStatement.exportPdf')}
            >
              <FileText className="size-3.5" />
              <span className="hidden sm:inline">{t('incomeStatement.exportPdf')}</span>
            </button>
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1.5"
              title={t('incomeStatement.refresh')}
            >
              <RefreshCcw className={classNames('size-3.5', refreshing && 'animate-spin')} />
              <span className="hidden sm:inline">{t('incomeStatement.refresh')}</span>
            </button>
          </div>
        </div>

        <ViewTabs view={view} setView={setView} />
      </div>

      {view === 'month' && month && <MonthView month={month} />}
      {view === 'trend' && <TrendView months={data.months} />}
      {view === 'quarterly' && <PeriodView periods={quarters} title={t('incomeStatement.quarterly')} />}
      {view === 'yearly' && <PeriodView periods={years} title={t('incomeStatement.yearly')} />}
    </div>
  )
}

function ViewTabs({ view, setView }: { view: ViewMode; setView: (v: ViewMode) => void }) {
  const { t } = useI18n()
  const tabs: Array<{ key: ViewMode; label: string }> = [
    { key: 'month',     label: t('incomeStatement.viewMonth') },
    { key: 'trend',     label: t('incomeStatement.viewTrend') },
    { key: 'quarterly', label: t('incomeStatement.viewQuarterly') },
    { key: 'yearly',    label: t('incomeStatement.viewYearly') },
  ]
  return (
    <div className="inline-flex rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5 self-start">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setView(tab.key)}
          className={classNames(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            view === tab.key
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ── Single month view ─────────────────────────────────────────────────────

function MonthView({ month }: { month: IncomeStatementMonth }) {
  const { t } = useI18n()
  const revenue = month.totals.income
  const cogs = month.totals.cogs
  const expense = month.totals.expense
  const grossProfit = month.derived.grossProfit
  const netIncome = month.derived.netIncome
  const ebitda = month.derived.ebitda

  const kpis = [
    { label: t('incomeStatement.revenue'),       value: revenue,     positiveIsGood: true },
    { label: t('incomeStatement.cogs'),          value: cogs,        positiveIsGood: false },
    { label: t('incomeStatement.grossProfit'),   value: grossProfit, positiveIsGood: true },
    { label: t('incomeStatement.opEx'),          value: expense,     positiveIsGood: false },
    { label: t('incomeStatement.netIncome'),     value: netIncome,   positiveIsGood: true },
    { label: t('incomeStatement.ebitda'),        value: ebitda,      positiveIsGood: true, emphasized: true },
  ]

  const chartData = [
    { name: t('incomeStatement.revenue'),     amount: revenue,     kind: 'income' },
    { name: t('incomeStatement.cogs'),        amount: cogs,        kind: 'cost' },
    { name: t('incomeStatement.grossProfit'), amount: grossProfit, kind: grossProfit >= 0 ? 'profit' : 'loss' },
    { name: t('incomeStatement.opEx'),        amount: expense,     kind: 'cost' },
    { name: t('incomeStatement.netIncome'),   amount: netIncome,   kind: netIncome >= 0 ? 'profit' : 'loss' },
    { name: t('incomeStatement.ebitda'),      amount: ebitda,      kind: ebitda >= 0 ? 'profit' : 'loss' },
  ]
  const colourFor = (kind: string) => {
    if (kind === 'income') return '#2563eb'
    if (kind === 'cost') return '#dc2626'
    if (kind === 'profit') return '#16a34a'
    return '#b91c1c'
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpis.map((k) => (
          <div
            key={k.label}
            className={classNames(
              'rounded-lg border bg-white dark:bg-gray-800 p-3',
              k.emphasized ? 'border-amber-400 dark:border-amber-500/70 ring-1 ring-amber-200 dark:ring-amber-500/30' : 'border-gray-200 dark:border-gray-700',
            )}
          >
            <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{k.label}</p>
            <p className={classNames(
              'text-lg font-semibold mt-0.5',
              k.value >= 0 ? (k.positiveIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-900 dark:text-gray-100')
                            : (k.positiveIsGood ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'),
            )}>
              <AnimatedNumber value={currencyFmtSigned.format(k.value)} />
            </p>
            {revenue !== 0 && (
              <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                {percentFmt.format(k.value / revenue)} {t('incomeStatement.ofRevenue')}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h2 className="text-sm font-semibold mb-3">{t('incomeStatement.chartTitle')} — {month.label}</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-300 dark:text-gray-600" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-700 dark:text-gray-200" axisLine={{ stroke: 'currentColor', opacity: 0.4 }} tickLine={{ stroke: 'currentColor', opacity: 0.4 }} />
              <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-700 dark:text-gray-200" tickFormatter={(v) => currencyFmt.format(v)} width={80} axisLine={{ stroke: 'currentColor', opacity: 0.4 }} tickLine={{ stroke: 'currentColor', opacity: 0.4 }} />
              <Tooltip
                formatter={(v) => currencyFmtSigned.format(Number(v ?? 0))}
                contentStyle={{ background: 'rgba(17,24,39,0.95)', color: '#f9fafb', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#f9fafb' }}
                itemStyle={{ color: '#f9fafb' }}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {chartData.map((d, i) => (<Cell key={i} fill={colourFor(d.kind)} />))}
                <LabelList dataKey="amount" position="top" formatter={(v) => currencyFmt.format(Number(v ?? 0))} style={{ fontSize: 11, fontWeight: 600, fill: 'currentColor' }} className="text-gray-900 dark:text-gray-100" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-3">
        <BreakdownSection title={t('incomeStatement.sectionIncome')} items={month.income} total={month.totals.income} revenue={revenue} defaultOpen={true} />
        <BreakdownSection title={t('incomeStatement.sectionCogs')} items={month.cogs} total={month.totals.cogs} revenue={revenue} />
        <BreakdownSection title={t('incomeStatement.sectionExpense')} items={month.expense} total={month.totals.expense} revenue={revenue} />
        {month.otherExpense.length > 0 && (
          <BreakdownSection title={t('incomeStatement.sectionOtherExpense')} items={month.otherExpense} total={month.totals.otherExpense} revenue={revenue} />
        )}
      </div>
    </div>
  )
}

// ── Monthly trend view ────────────────────────────────────────────────────

function TrendView({ months }: { months: IncomeStatementMonth[] }) {
  const { t } = useI18n()
  const chartData = months.map((m) => ({
    name: m.label,
    Revenue: m.totals.income,
    'Cost of Sales': m.totals.cogs,
    'Operating Expenses': m.totals.expense,
    'Net Income': m.derived.netIncome,
    EBITDA: m.derived.ebitda,
  }))

  // MoM delta for the latest month vs the prior month, per metric.
  const last = months[months.length - 1]
  const prev = months[months.length - 2]
  const moM = (g: (m: IncomeStatementMonth) => number) => {
    if (!last || !prev) return null
    const a = g(last), b = g(prev)
    if (b === 0) return null
    return (a - b) / Math.abs(b)
  }

  return (
    <div className="space-y-6">
      {last && prev && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <ComparisonCard label={t('incomeStatement.revenue')}   current={last.totals.income} prior={prev.totals.income} delta={moM((m) => m.totals.income)} positiveIsGood />
          <ComparisonCard label={t('incomeStatement.cogs')}      current={last.totals.cogs}   prior={prev.totals.cogs}   delta={moM((m) => m.totals.cogs)} positiveIsGood={false} />
          <ComparisonCard label={t('incomeStatement.grossProfit')} current={last.derived.grossProfit} prior={prev.derived.grossProfit} delta={moM((m) => m.derived.grossProfit)} positiveIsGood />
          <ComparisonCard label={t('incomeStatement.netIncome')} current={last.derived.netIncome} prior={prev.derived.netIncome} delta={moM((m) => m.derived.netIncome)} positiveIsGood />
          <ComparisonCard label={t('incomeStatement.ebitda')}    current={last.derived.ebitda}    prior={prev.derived.ebitda}    delta={moM((m) => m.derived.ebitda)}    positiveIsGood emphasized />
        </div>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h2 className="text-sm font-semibold mb-3">{t('incomeStatement.trendTitle')}</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-300 dark:text-gray-600" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-700 dark:text-gray-200" axisLine={{ stroke: 'currentColor', opacity: 0.4 }} tickLine={{ stroke: 'currentColor', opacity: 0.4 }} />
              <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-700 dark:text-gray-200" tickFormatter={(v) => currencyFmt.format(v)} width={80} axisLine={{ stroke: 'currentColor', opacity: 0.4 }} tickLine={{ stroke: 'currentColor', opacity: 0.4 }} />
              <Tooltip
                formatter={(v) => currencyFmtSigned.format(Number(v ?? 0))}
                contentStyle={{ background: 'rgba(17,24,39,0.95)', color: '#f9fafb', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#f9fafb' }}
                itemStyle={{ color: '#f9fafb' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Revenue"             stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Cost of Sales"       stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Operating Expenses"  stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Net Income"          stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="EBITDA"              stroke="#a855f7" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <TrendTable months={months} />
    </div>
  )
}

function TrendTable({ months }: { months: IncomeStatementMonth[] }) {
  const { t } = useI18n()
  const rows: Array<{ label: string; getter: (m: IncomeStatementMonth) => number }> = [
    { label: t('incomeStatement.revenue'),     getter: (m) => m.totals.income },
    { label: t('incomeStatement.cogs'),        getter: (m) => m.totals.cogs },
    { label: t('incomeStatement.grossProfit'), getter: (m) => m.derived.grossProfit },
    { label: t('incomeStatement.opEx'),        getter: (m) => m.totals.expense },
    { label: t('incomeStatement.netIncome'),   getter: (m) => m.derived.netIncome },
    { label: t('incomeStatement.ebitda'),      getter: (m) => m.derived.ebitda },
  ]
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">{t('incomeStatement.metric')}</th>
            {months.map((m) => (<th key={m.monthIso} className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400">{m.label}</th>))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50 last:border-b-0">
              <td className="px-3 py-1.5 font-medium sticky left-0 bg-white dark:bg-gray-800">{row.label}</td>
              {months.map((m) => {
                const v = row.getter(m)
                return (
                  <td key={m.monthIso} className={classNames(
                    'px-3 py-1.5 text-right tabular-nums',
                    v < 0 ? 'text-red-600 dark:text-red-400' : '',
                  )}>{currencyFmtSigned.format(v)}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Quarterly / yearly view ───────────────────────────────────────────────

function PeriodView({ periods, title }: { periods: AggregatedPeriod[]; title: string }) {
  const { t } = useI18n()
  if (periods.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 text-sm text-gray-600 dark:text-gray-400">
        {t('incomeStatement.noPeriods')}
      </div>
    )
  }

  const chartData = periods.map((p) => ({
    name: p.label,
    Revenue: p.totals.income,
    'Cost of Sales': p.totals.cogs,
    'Operating Expenses': p.totals.expense,
    'Net Income': p.derived.netIncome,
    EBITDA: p.derived.ebitda,
  }))

  const last = periods[periods.length - 1]
  const prev = periods[periods.length - 2]
  const delta = (g: (p: AggregatedPeriod) => number) => {
    if (!last || !prev) return null
    const a = g(last), b = g(prev)
    if (b === 0) return null
    return (a - b) / Math.abs(b)
  }

  return (
    <div className="space-y-6">
      {last && prev && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <ComparisonCard label={t('incomeStatement.revenue')}      current={last.totals.income} prior={prev.totals.income} delta={delta((p) => p.totals.income)} positiveIsGood />
          <ComparisonCard label={t('incomeStatement.cogs')}         current={last.totals.cogs}   prior={prev.totals.cogs}   delta={delta((p) => p.totals.cogs)}   positiveIsGood={false} />
          <ComparisonCard label={t('incomeStatement.grossProfit')}  current={last.derived.grossProfit} prior={prev.derived.grossProfit} delta={delta((p) => p.derived.grossProfit)} positiveIsGood />
          <ComparisonCard label={t('incomeStatement.netIncome')}    current={last.derived.netIncome}   prior={prev.derived.netIncome}   delta={delta((p) => p.derived.netIncome)}   positiveIsGood />
          <ComparisonCard label={t('incomeStatement.ebitda')}       current={last.derived.ebitda}     prior={prev.derived.ebitda}     delta={delta((p) => p.derived.ebitda)}     positiveIsGood emphasized />
        </div>
      )}

      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h2 className="text-sm font-semibold mb-3">{title}</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-gray-300 dark:text-gray-600" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-700 dark:text-gray-200" axisLine={{ stroke: 'currentColor', opacity: 0.4 }} tickLine={{ stroke: 'currentColor', opacity: 0.4 }} />
              <YAxis tick={{ fontSize: 11, fill: 'currentColor' }} className="text-gray-700 dark:text-gray-200" tickFormatter={(v) => currencyFmt.format(v)} width={80} axisLine={{ stroke: 'currentColor', opacity: 0.4 }} tickLine={{ stroke: 'currentColor', opacity: 0.4 }} />
              <Tooltip
                formatter={(v) => currencyFmtSigned.format(Number(v ?? 0))}
                contentStyle={{ background: 'rgba(17,24,39,0.95)', color: '#f9fafb', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#f9fafb' }}
                itemStyle={{ color: '#f9fafb' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Revenue"            fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Cost of Sales"      fill="#dc2626" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Operating Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Net Income"         fill="#16a34a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="EBITDA"             fill="#a855f7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <PeriodTable periods={periods} />
    </div>
  )
}

function PeriodTable({ periods }: { periods: AggregatedPeriod[] }) {
  const { t } = useI18n()
  const rows: Array<{ label: string; getter: (p: AggregatedPeriod) => number }> = [
    { label: t('incomeStatement.revenue'),     getter: (p) => p.totals.income },
    { label: t('incomeStatement.cogs'),        getter: (p) => p.totals.cogs },
    { label: t('incomeStatement.grossProfit'), getter: (p) => p.derived.grossProfit },
    { label: t('incomeStatement.opEx'),        getter: (p) => p.totals.expense },
    { label: t('incomeStatement.netIncome'),   getter: (p) => p.derived.netIncome },
    { label: t('incomeStatement.interest'),    getter: (p) => p.derived.interest },
    { label: t('incomeStatement.depreciation'),getter: (p) => p.derived.depreciation },
    { label: t('incomeStatement.ebitda'),      getter: (p) => p.derived.ebitda },
  ]
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="text-left px-3 py-2 font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-800">{t('incomeStatement.metric')}</th>
            {periods.map((p) => (
              <th key={p.key} className="text-right px-3 py-2 font-medium text-gray-600 dark:text-gray-400" title={p.monthLabels.join(', ')}>
                <div>{p.label}</div>
                <div className="text-[10px] font-normal text-gray-400 dark:text-gray-500">{p.monthCount} mo</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50 last:border-b-0">
              <td className="px-3 py-1.5 font-medium sticky left-0 bg-white dark:bg-gray-800">{row.label}</td>
              {periods.map((p) => {
                const v = row.getter(p)
                return (
                  <td key={p.key} className={classNames(
                    'px-3 py-1.5 text-right tabular-nums',
                    v < 0 ? 'text-red-600 dark:text-red-400' : '',
                  )}>{currencyFmtSigned.format(v)}</td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ComparisonCard({ label, current, prior, delta, positiveIsGood, emphasized }: {
  label: string
  current: number
  prior: number
  delta: number | null
  positiveIsGood: boolean
  emphasized?: boolean
}) {
  const isGood = delta !== null && (positiveIsGood ? delta >= 0 : delta <= 0)
  return (
    <div className={classNames(
      'rounded-lg border bg-white dark:bg-gray-800 p-3',
      emphasized ? 'border-amber-400 dark:border-amber-500/70 ring-1 ring-amber-200 dark:ring-amber-500/30' : 'border-gray-200 dark:border-gray-700',
    )}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p className={classNames(
        'text-lg font-semibold mt-0.5',
        current < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100',
      )}>
        {currencyFmtSigned.format(current)}
      </p>
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
        prior: {currencyFmtSigned.format(prior)}
      </p>
      {delta !== null && (
        <p className={classNames(
          'text-xs font-semibold mt-1',
          isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        )}>
          {delta >= 0 ? '▲' : '▼'} {percentFmt.format(Math.abs(delta))}
        </p>
      )}
    </div>
  )
}

function BreakdownSection({
  title, items, total, revenue, defaultOpen = false,
}: {
  title: string
  items: LineItem[]
  total: number
  revenue: number
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (items.length === 0) return null
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="size-4 text-gray-500" /> : <ChevronRight className="size-4 text-gray-500" />}
          <span className="font-semibold text-sm">{title}</span>
          <span className="text-xs text-gray-500">({items.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tabular-nums">{currencyFmtSigned.format(total)}</span>
          {revenue !== 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums w-12 text-right">{percentFmt.format(total / revenue)}</span>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <tbody>
              {items.map((it) => (
                <tr key={it.account} className="border-b border-gray-100 dark:border-gray-700/50 last:border-b-0">
                  <td className="px-4 py-1.5 text-gray-700 dark:text-gray-300">{it.account}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{currencyFmtSigned.format(it.amount)}</td>
                  <td className="px-4 py-1.5 text-right text-xs text-gray-500 dark:text-gray-400 tabular-nums w-16">
                    {revenue !== 0 ? percentFmt.format(it.percentOfRevenue) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
