'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, LabelList,
} from 'recharts'
import { useI18n } from '@/lib/i18n'
import { TableSkeleton } from '@/components/ui/skeleton-loader'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { RefreshCcw, ChevronDown, ChevronRight, FileBarChart } from 'lucide-react'
import type { IncomeStatementResponse, IncomeStatementMonth, LineItem } from '@/lib/income-statement/types'

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
  const [selected, setSelected] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = async (refresh = false) => {
    try {
      if (refresh) setRefreshing(true)
      const r = await fetch(`/api/income-statement${refresh ? '?refresh=1' : ''}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const payload = (await r.json()) as IncomeStatementResponse
      setData(payload)
      // Default to the most recent month.
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

  const month: IncomeStatementMonth | null = useMemo(() => {
    if (!data || !selected) return null
    return data.months.find((m) => m.monthIso === selected) ?? null
  }, [data, selected])

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

  if (!data) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">{t('incomeStatement.title')}</h1>
        <TableSkeleton rows={8} />
      </div>
    )
  }

  if (data.months.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">{t('incomeStatement.title')}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('incomeStatement.noMonths')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
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
        <div className="flex items-center gap-2">
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium"
          >
            {data.months.map((m) => (
              <option key={m.monthIso} value={m.monthIso}>{m.label}</option>
            ))}
          </select>
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

      {month && <MonthView month={month} />}
    </div>
  )
}

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

  // Chart data: stack/colour-code the major P&L levels for the month.
  const chartData = [
    { name: t('incomeStatement.revenue'),     amount: revenue,     kind: 'income' },
    { name: t('incomeStatement.cogs'),        amount: cogs,        kind: 'cost' },
    { name: t('incomeStatement.grossProfit'), amount: grossProfit, kind: grossProfit >= 0 ? 'profit' : 'loss' },
    { name: t('incomeStatement.opEx'),        amount: expense,     kind: 'cost' },
    { name: t('incomeStatement.netIncome'),   amount: netIncome,   kind: netIncome >= 0 ? 'profit' : 'loss' },
    { name: t('incomeStatement.ebitda'),      amount: ebitda,      kind: ebitda >= 0 ? 'profit' : 'loss' },
  ]
  const colourFor = (kind: string) => {
    if (kind === 'income') return '#2563eb'  // blue-600
    if (kind === 'cost') return '#dc2626'    // red-600
    if (kind === 'profit') return '#16a34a'  // green-600
    return '#b91c1c'                          // red-700 (loss)
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
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

      {/* Bar chart */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h2 className="text-sm font-semibold mb-3">{t('incomeStatement.chartTitle')} — {month.label}</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.2)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => currencyFmt.format(v).replace('$', '$')} width={80} />
              <Tooltip
                formatter={(v) => currencyFmtSigned.format(Number(v ?? 0))}
                contentStyle={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                {chartData.map((d, i) => (<Cell key={i} fill={colourFor(d.kind)} />))}
                <LabelList dataKey="amount" position="top" formatter={(v) => currencyFmt.format(Number(v ?? 0))} style={{ fontSize: 10, fill: '#374151' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed breakdown */}
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
