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
}

export function HoursPayTable({ data, loading, dateFrom, dateTo, onDateChange }: HoursPayTableProps) {
  const { t } = useI18n()
  const [from, setFrom] = useState(dateFrom)
  const [to, setTo] = useState(dateTo)

  const handleApply = () => onDateChange(from, to)

  const exportCsv = () => {
    const headers = [
      t('scheduling.employee'),
      t('scheduling.totalHours'),
      t('scheduling.overtimeHours'),
      t('scheduling.payRate'),
      t('scheduling.grossPay'),
    ]
    const rows = data.map((r) => [r.employee_name, r.total_hours, r.ot_hours, r.pay_rate, r.total_pay])
    const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hours-pay-${from}-to-${to}.csv`
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
          <Label className="text-zinc-400 text-xs">{t('scheduling.startTime')}</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-zinc-900 border-zinc-800 text-white w-40"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-zinc-400 text-xs">{t('scheduling.endTime')}</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-zinc-900 border-zinc-800 text-white w-40"
          />
        </div>
        <Button onClick={handleApply} size="sm" className="bg-blue-600 hover:bg-blue-700">
          Apply
        </Button>
        <Button onClick={exportCsv} variant="outline" size="sm" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 ml-auto">
          <Download className="size-4 mr-1" /> {t('scheduling.exportCsv')}
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border border-zinc-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-800 hover:bg-transparent">
              <TableHead className="text-zinc-400">{t('scheduling.employee')}</TableHead>
              <TableHead className="text-zinc-400 text-right">{t('scheduling.totalHours')}</TableHead>
              <TableHead className="text-zinc-400 text-right">{t('scheduling.overtimeHours')}</TableHead>
              <TableHead className="text-zinc-400 text-right">{t('scheduling.payRate')}</TableHead>
              <TableHead className="text-zinc-400 text-right">{t('scheduling.grossPay')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-zinc-500">Loading...</TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-zinc-500">{t('scheduling.noSchedule')}</TableCell>
              </TableRow>
            ) : (
              <>
                {data.map((row) => (
                  <TableRow key={row.employee_id} className="border-zinc-800/50 hover:bg-zinc-900/50">
                    <TableCell className="text-white font-medium">{row.employee_name}</TableCell>
                    <TableCell className="text-right text-white">{row.total_hours.toFixed(1)}</TableCell>
                    <TableCell className={`text-right ${row.ot_hours > 0 ? 'text-amber-400 font-semibold' : 'text-white'}`}>
                      {row.ot_hours.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right text-zinc-300">${row.pay_rate.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-emerald-400 font-semibold">${row.total_pay.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {/* Totals row */}
                <TableRow className="border-zinc-700 bg-zinc-900/70 font-bold">
                  <TableCell className="text-white">Total</TableCell>
                  <TableCell className="text-right text-white">{totals.hours.toFixed(1)}</TableCell>
                  <TableCell className={`text-right ${totals.ot > 0 ? 'text-amber-400' : 'text-white'}`}>{totals.ot.toFixed(1)}</TableCell>
                  <TableCell className="text-right text-zinc-500">—</TableCell>
                  <TableCell className="text-right text-emerald-400">${totals.pay.toFixed(2)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
