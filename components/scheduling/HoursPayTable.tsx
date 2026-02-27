'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Download } from 'lucide-react'

interface HoursPayRow {
  employee_id: string
  employee_name: string
  total_hours: number
  regular_hours: number
  ot_hours: number
  pay_rate: number
  total_pay: number
}

interface HoursPayTableProps {
  data: HoursPayRow[]
  loading: boolean
  dateFrom: string
  dateTo: string
  onDateChange: (from: string, to: string) => void
  /** Whether to show pay rate and gross pay columns (admin/manager only) */
  showPay: boolean
}

export function HoursPayTable({ data, loading, dateFrom, dateTo, onDateChange, showPay }: HoursPayTableProps) {
  const { t } = useI18n()
  const [from, setFrom] = useState(dateFrom)
  const [to, setTo] = useState(dateTo)

  const handleApply = () => onDateChange(from, to)

  const colCount = showPay ? 5 : 3

  const exportCsv = () => {
    const headers = [
      t('scheduling.employee'),
      t('scheduling.totalHours'),
      t('scheduling.overtimeHours'),
      ...(showPay ? [t('scheduling.payRate'), t('scheduling.grossPay')] : []),
    ]
    const rows = data.map((r) => [
      r.employee_name,
      r.total_hours,
      r.ot_hours,
      ...(showPay ? [r.pay_rate, r.total_pay] : []),
    ])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hours${showPay ? '-pay' : ''}-${from}-to-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const totals = data.reduce(
    (acc, r) => ({
      hours: acc.hours + r.total_hours,
      ot: acc.ot + r.ot_hours,
      pay: acc.pay + r.total_pay,
    }),
    { hours: 0, ot: 0, pay: 0 }
  )

  return (
    <div className="space-y-4">
      {/* Date range + export */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">{t('scheduling.startTime')}</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-muted border-border text-foreground w-40"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">{t('scheduling.endTime')}</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-muted border-border text-foreground w-40"
          />
        </div>
        <Button onClick={handleApply} size="sm" className="bg-blue-600 hover:bg-blue-700">
          Apply
        </Button>
        <Button onClick={exportCsv} variant="outline" size="sm" className="border-border text-foreground/80 hover:bg-accent ml-auto">
          <Download className="size-4 mr-1" /> {t('scheduling.exportCsv')}
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">{t('scheduling.employee')}</TableHead>
              <TableHead className="text-muted-foreground text-right">{t('scheduling.totalHours')}</TableHead>
              <TableHead className="text-muted-foreground text-right">{t('scheduling.overtimeHours')}</TableHead>
              {showPay && <TableHead className="text-muted-foreground text-right">{t('scheduling.payRate')}</TableHead>}
              {showPay && <TableHead className="text-muted-foreground text-right">{t('scheduling.grossPay')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">{t('scheduling.noSchedule')}</TableCell>
              </TableRow>
            ) : (
              <>
                {data.map((row) => (
                  <TableRow key={row.employee_id} className="border-border/50 hover:bg-muted/50">
                    <TableCell className="text-foreground font-medium">{row.employee_name}</TableCell>
                    <TableCell className="text-right text-foreground">{row.total_hours.toFixed(1)}</TableCell>
                    <TableCell className={`text-right ${row.ot_hours > 0 ? 'text-amber-400 font-semibold' : 'text-foreground'}`}>
                      {row.ot_hours.toFixed(1)}
                    </TableCell>
                    {showPay && <TableCell className="text-right text-foreground/80">${row.pay_rate.toFixed(2)}</TableCell>}
                    {showPay && <TableCell className="text-right text-emerald-400 font-semibold">${row.total_pay.toFixed(2)}</TableCell>}
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="border-border bg-muted/70 font-bold">
                  <TableCell className="text-foreground">Total</TableCell>
                  <TableCell className="text-right text-foreground">{totals.hours.toFixed(1)}</TableCell>
                  <TableCell className={`text-right ${totals.ot > 0 ? 'text-amber-400' : 'text-foreground'}`}>{totals.ot.toFixed(1)}</TableCell>
                  {showPay && <TableCell className="text-right text-muted-foreground">—</TableCell>}
                  {showPay && <TableCell className="text-right text-emerald-400">${totals.pay.toFixed(2)}</TableCell>}
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
