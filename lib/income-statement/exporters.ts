import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { IncomeStatementMonth, IncomeStatementResponse } from './types'
import type { AggregatedPeriod } from './aggregations'

const currency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, signDisplay: 'auto' }).format(n)
const percent = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n)

// ---------- XLSX ----------

export function exportMonthXlsx(month: IncomeStatementMonth) {
  const revenue = month.totals.income
  const rows: Array<Array<string | number>> = []
  rows.push(['Compression Molding Income Statement'])
  rows.push([month.label])
  rows.push([])

  const sect = (title: string, items: IncomeStatementMonth['income'], totalLabel: string, total: number) => {
    rows.push([title, 'Amount', '% of Revenue'])
    for (const it of items) rows.push([it.account, it.amount, revenue !== 0 ? it.amount / revenue : 0])
    rows.push([totalLabel, total, revenue !== 0 ? total / revenue : 0])
    rows.push([])
  }
  sect('Income', month.income, 'Total - Income', month.totals.income)
  sect('Cost of Sales', month.cogs, 'Total - Cost of Sales', month.totals.cogs)
  sect('Operating Expenses', month.expense, 'Total - Operating Expenses', month.totals.expense)
  if (month.otherExpense.length > 0) sect('Other Expenses', month.otherExpense, 'Total - Other Expenses', month.totals.otherExpense)

  rows.push(['Gross Profit', month.derived.grossProfit, revenue !== 0 ? month.derived.grossProfit / revenue : 0])
  rows.push(['Net Ordinary Income', month.derived.netOrdinaryIncome, revenue !== 0 ? month.derived.netOrdinaryIncome / revenue : 0])
  rows.push(['Net Income', month.derived.netIncome, revenue !== 0 ? month.derived.netIncome / revenue : 0])
  rows.push(['Interest', month.derived.interest, revenue !== 0 ? month.derived.interest / revenue : 0])
  rows.push(['Depreciation', month.derived.depreciation, revenue !== 0 ? month.derived.depreciation / revenue : 0])
  rows.push(['EBITDA', month.derived.ebitda, revenue !== 0 ? month.derived.ebitda / revenue : 0])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 50 }, { wch: 16 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, month.label)
  XLSX.writeFile(wb, `income-statement-${month.monthIso}.xlsx`)
}

export function exportTrendXlsx(months: IncomeStatementMonth[]) {
  const header = ['Metric', ...months.map((m) => m.label)]
  const rows: Array<Array<string | number>> = [header]
  const push = (name: string, getter: (m: IncomeStatementMonth) => number) =>
    rows.push([name, ...months.map((m) => getter(m))])
  push('Revenue',              (m) => m.totals.income)
  push('Cost of Sales',        (m) => m.totals.cogs)
  push('Gross Profit',         (m) => m.derived.grossProfit)
  push('Operating Expenses',   (m) => m.totals.expense)
  push('Other Expenses',       (m) => m.totals.otherExpense)
  push('Net Ordinary Income',  (m) => m.derived.netOrdinaryIncome)
  push('Net Income',           (m) => m.derived.netIncome)
  push('Interest',             (m) => m.derived.interest)
  push('Depreciation',         (m) => m.derived.depreciation)
  push('EBITDA',               (m) => m.derived.ebitda)

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 22 }, ...months.map(() => ({ wch: 13 }))]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Monthly Trend')
  XLSX.writeFile(wb, `income-statement-monthly-trend.xlsx`)
}

export function exportPeriodsXlsx(periods: AggregatedPeriod[], filename: string, sheetName: string) {
  const header = ['Metric', ...periods.map((p) => p.label)]
  const rows: Array<Array<string | number>> = [header]
  const push = (name: string, getter: (p: AggregatedPeriod) => number) =>
    rows.push([name, ...periods.map(getter)])
  push('Revenue',              (p) => p.totals.income)
  push('Cost of Sales',        (p) => p.totals.cogs)
  push('Gross Profit',         (p) => p.derived.grossProfit)
  push('Operating Expenses',   (p) => p.totals.expense)
  push('Other Expenses',       (p) => p.totals.otherExpense)
  push('Net Income',           (p) => p.derived.netIncome)
  push('Interest',             (p) => p.derived.interest)
  push('Depreciation',         (p) => p.derived.depreciation)
  push('EBITDA',               (p) => p.derived.ebitda)

  rows.push([])
  rows.push(['Months included:', ...periods.map((p) => p.monthLabels.join(', '))])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 22 }, ...periods.map(() => ({ wch: 16 }))]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

// ---------- PDF ----------

export function exportMonthPdf(month: IncomeStatementMonth) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const revenue = month.totals.income

  doc.setFontSize(16).setFont('helvetica', 'bold').text('Compression Molding — Income Statement', 40, 50)
  doc.setFontSize(11).setFont('helvetica', 'normal').text(month.label, 40, 70)
  doc.setFontSize(9).setTextColor(120).text(`Generated ${new Date().toLocaleString()}`, 40, 85)
  doc.setTextColor(0)

  const summary = [
    ['Revenue',            currency(month.totals.income),     percent(1)],
    ['Cost of Sales',      currency(month.totals.cogs),       revenue !== 0 ? percent(month.totals.cogs / revenue) : '—'],
    ['Gross Profit',       currency(month.derived.grossProfit), revenue !== 0 ? percent(month.derived.grossProfit / revenue) : '—'],
    ['Operating Expenses', currency(month.totals.expense),    revenue !== 0 ? percent(month.totals.expense / revenue) : '—'],
    ['Net Income',         currency(month.derived.netIncome), revenue !== 0 ? percent(month.derived.netIncome / revenue) : '—'],
    ['Interest',           currency(month.derived.interest),  revenue !== 0 ? percent(month.derived.interest / revenue) : '—'],
    ['Depreciation',       currency(month.derived.depreciation), revenue !== 0 ? percent(month.derived.depreciation / revenue) : '—'],
    ['EBITDA',             currency(month.derived.ebitda),    revenue !== 0 ? percent(month.derived.ebitda / revenue) : '—'],
  ]
  autoTable(doc, {
    startY: 100,
    head: [['Summary', 'Amount', '% Revenue']],
    body: summary,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  })

  const section = (title: string, items: IncomeStatementMonth['income'], total: number) => {
    if (items.length === 0) return
    const body = items.map((it) => [it.account, currency(it.amount), revenue !== 0 ? percent(it.percentOfRevenue) : '—'])
    body.push([`Total — ${title}`, currency(total), revenue !== 0 ? percent(total / revenue) : '—'])
    autoTable(doc, {
      head: [[title, 'Amount', '% Revenue']],
      body,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [55, 65, 81] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      didParseCell: (data) => {
        if (data.row.index === items.length && data.section === 'body') {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [243, 244, 246]
        }
      },
    })
  }
  section('Income', month.income, month.totals.income)
  section('Cost of Sales', month.cogs, month.totals.cogs)
  section('Operating Expenses', month.expense, month.totals.expense)
  section('Other Expenses', month.otherExpense, month.totals.otherExpense)

  doc.save(`income-statement-${month.monthIso}.pdf`)
}

export function exportTrendPdf(months: IncomeStatementMonth[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  doc.setFontSize(16).setFont('helvetica', 'bold').text('Compression Molding — Monthly Trend', 40, 50)
  doc.setFontSize(9).setTextColor(120).text(`Generated ${new Date().toLocaleString()}`, 40, 70)
  doc.setTextColor(0)

  const head = [['Metric', ...months.map((m) => m.label)]]
  const row = (name: string, getter: (m: IncomeStatementMonth) => number) =>
    [name, ...months.map((m) => currency(getter(m)))]
  const body = [
    row('Revenue',            (m) => m.totals.income),
    row('Cost of Sales',      (m) => m.totals.cogs),
    row('Gross Profit',       (m) => m.derived.grossProfit),
    row('Operating Expenses', (m) => m.totals.expense),
    row('Other Expenses',     (m) => m.totals.otherExpense),
    row('Net Income',         (m) => m.derived.netIncome),
    row('Interest',           (m) => m.derived.interest),
    row('Depreciation',       (m) => m.derived.depreciation),
    row('EBITDA',             (m) => m.derived.ebitda),
  ]
  autoTable(doc, {
    startY: 90,
    head,
    body,
    styles: { fontSize: 8, halign: 'right' },
    headStyles: { fillColor: [37, 99, 235], halign: 'center' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
  })
  doc.save('income-statement-monthly-trend.pdf')
}

export function exportPeriodsPdf(periods: AggregatedPeriod[], title: string, filename: string) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  doc.setFontSize(16).setFont('helvetica', 'bold').text(`Compression Molding — ${title}`, 40, 50)
  doc.setFontSize(9).setTextColor(120).text(`Generated ${new Date().toLocaleString()}`, 40, 70)
  doc.setTextColor(0)

  const head = [['Metric', ...periods.map((p) => p.label)]]
  const row = (name: string, getter: (p: AggregatedPeriod) => number) =>
    [name, ...periods.map((p) => currency(getter(p)))]
  const body = [
    row('Revenue',            (p) => p.totals.income),
    row('Cost of Sales',      (p) => p.totals.cogs),
    row('Gross Profit',       (p) => p.derived.grossProfit),
    row('Operating Expenses', (p) => p.totals.expense),
    row('Other Expenses',     (p) => p.totals.otherExpense),
    row('Net Income',         (p) => p.derived.netIncome),
    row('Interest',           (p) => p.derived.interest),
    row('Depreciation',       (p) => p.derived.depreciation),
    row('EBITDA',             (p) => p.derived.ebitda),
  ]
  autoTable(doc, {
    startY: 90,
    head,
    body,
    styles: { fontSize: 9, halign: 'right' },
    headStyles: { fillColor: [37, 99, 235], halign: 'center' },
    columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
  })
  doc.save(filename)
}
