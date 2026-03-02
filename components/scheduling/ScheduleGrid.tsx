'use client'

import { useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ChevronDown, ChevronUp } from 'lucide-react'

export interface ScheduleEmployee {
  id: string
  employee_id: string
  first_name: string
  last_name: string
  department: string
  default_shift: number
  shift_length: number
  pay_rate?: number
  is_active: boolean
}

export interface ScheduleEntry {
  id: string
  employee_id: string
  date: string
  shift: number
  start_time: string
  end_time: string
  machine_id: string | null
  machine_name?: string | null
  hours: number
}

interface ScheduleGridProps {
  entries: ScheduleEntry[]
  employees: ScheduleEmployee[]
  weekDates: Date[]
  canEdit: boolean
  onCellClick: (employeeId: string, date: Date, existing?: ScheduleEntry) => void
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${h12}:${m} ${ampm}`
}

function formatDayHeader(date: Date, language: string) {
  const dayName = date.toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', { weekday: 'short' })
  const dayNum = date.getDate()
  return { dayName, dayNum }
}

function isToday(date: Date) {
  const now = new Date()
  return date.toDateString() === now.toDateString()
}

export function ScheduleGrid({ entries, employees, weekDates, canEdit, onCellClick }: ScheduleGridProps) {
  const { t, language } = useI18n()
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)

  const entryMap = new Map<string, ScheduleEntry>()
  for (const e of entries) {
    entryMap.set(`${e.employee_id}::${e.date}`, e)
  }

  const getEntry = (empId: string, date: Date): ScheduleEntry | undefined => {
    const dateStr = date.toISOString().split('T')[0]
    return entryMap.get(`${empId}::${dateStr}`)
  }

  // Desktop grid
  const desktopGrid = (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 bg-background px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-[180px]">
              {t('scheduling.employee')}
            </th>
            {weekDates.map((date) => {
              const { dayName, dayNum } = formatDayHeader(date, language)
              const today = isToday(date)
              return (
                <th
                  key={date.toISOString()}
                  className={`px-2 py-3 text-center text-xs font-medium uppercase tracking-wider min-w-[120px] ${
                    today ? 'text-blue-400 bg-blue-500/5' : 'text-muted-foreground'
                  }`}
                >
                  <div>{dayName}</div>
                  <div className={`text-lg font-bold ${today ? 'text-blue-300' : 'text-foreground'}`}>{dayNum}</div>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.employee_id} className="border-b border-border/50 hover:bg-muted/50">
              <td className="sticky left-0 z-10 bg-background px-4 py-2">
                <div className="text-sm font-medium text-foreground">{emp.last_name}, {emp.first_name}</div>
                <div className="text-xs text-muted-foreground">#{emp.employee_id}</div>
              </td>
              {weekDates.map((date) => {
                const entry = getEntry(emp.employee_id, date)
                const today = isToday(date)
                const shiftColor = entry
                  ? entry.shift === 1
                    ? 'bg-blue-500/20 border-blue-500/30'
                    : 'bg-purple-500/20 border-purple-500/30'
                  : ''

                return (
                  <td
                    key={date.toISOString()}
                    onClick={() => canEdit && onCellClick(emp.employee_id, date, entry)}
                    className={`px-2 py-2 text-center border border-border/30 ${
                      today ? 'bg-blue-500/5' : ''
                    } ${canEdit ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                  >
                    {entry ? (
                      <div className={`rounded-md p-1.5 ${shiftColor} border`}>
                        <div className="text-xs font-medium text-foreground">
                          {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
                        </div>
                        {entry.machine_name && (
                          <Badge variant="secondary" className="mt-1 text-[10px] bg-accent text-foreground/80 border-0">
                            {entry.machine_name}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs py-2">—</div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
          {employees.length === 0 && (
            <tr>
              <td colSpan={weekDates.length + 1} className="text-center py-12 text-muted-foreground">
                {t('scheduling.noSchedule')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  // Mobile card layout
  const mobileCards = (
    <div className="md:hidden space-y-3">
      {employees.map((emp) => {
        const isExpanded = expandedEmployee === emp.employee_id
        const employeeEntries = weekDates
          .map((date) => ({ date, entry: getEntry(emp.employee_id, date) }))
          .filter((item): item is { date: Date; entry: ScheduleEntry } => Boolean(item.entry))

        return (
          <Card key={emp.employee_id} className="bg-muted border-border p-3">
            <button
              type="button"
              onClick={() => setExpandedEmployee(isExpanded ? null : emp.employee_id)}
              className="w-full flex items-center justify-between mb-2 text-left"
            >
              <div>
                <div className="text-sm font-medium text-foreground">{emp.last_name}, {emp.first_name}</div>
                <div className="text-xs text-muted-foreground">#{emp.employee_id}</div>
              </div>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
            <div className="grid grid-cols-7 gap-1">
              {weekDates.map((date) => {
                const entry = getEntry(emp.employee_id, date)
                const today = isToday(date)
                const { dayName } = formatDayHeader(date, language)
                const shiftBg = entry
                  ? entry.shift === 1 ? 'bg-blue-500/20' : 'bg-purple-500/20'
                  : 'bg-accent/30'

                return (
                  <div
                    key={date.toISOString()}
                    onClick={() => canEdit && onCellClick(emp.employee_id, date, entry)}
                    className={`rounded p-1 text-center ${shiftBg} ${today ? 'ring-1 ring-blue-500' : ''} ${canEdit ? 'cursor-pointer' : ''}`}
                  >
                    <div className="text-[10px] text-muted-foreground">{dayName}</div>
                    <div className="text-[10px] font-medium text-foreground">{date.getDate()}</div>
                    {entry && (
                      <div className={`w-2 h-2 rounded-full mx-auto mt-0.5 ${entry.shift === 1 ? 'bg-blue-400' : 'bg-purple-400'}`} />
                    )}
                  </div>
                )
              })}
            </div>
            <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="border-t border-border/70 pt-2 space-y-1.5">
                  {employeeEntries.length > 0 ? (
                    employeeEntries.map(({ date, entry }) => (
                      <div key={`${emp.employee_id}-${entry.id}`} className="text-[11px] leading-4 text-muted-foreground">
                        <span className="text-foreground">
                          {date.toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', {
                            weekday: 'short',
                            month: 'numeric',
                            day: 'numeric',
                          })}
                        </span>
                        <span>{`: ${language === 'es' ? 'Turno' : 'Shift'} ${entry.shift}`}</span>
                        <span>{` • ${formatTime(entry.start_time)} - ${formatTime(entry.end_time)}`}</span>
                        {entry.machine_name && <span>{` • ${language === 'es' ? 'Maquina' : 'Machine'}: ${entry.machine_name}`}</span>}
                        <span>{` • ${entry.hours}h`}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-[11px] text-muted-foreground">{t('scheduling.noSchedule')}</div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )

  return (
    <>
      {desktopGrid}
      {mobileCards}
    </>
  )
}
