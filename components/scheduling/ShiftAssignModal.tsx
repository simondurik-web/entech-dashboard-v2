'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/lib/i18n'
import type { ScheduleEntry } from './ScheduleGrid'

interface Machine {
  id: string
  name: string
}

interface ShiftAssignModalProps {
  open: boolean
  onClose: () => void
  employeeId: string
  employeeName: string
  /** The employee's default shift (1 or 2) */
  employeeDefaultShift?: number
  date: Date
  /** Monday of the current week */
  weekMonday: Date
  existing?: ScheduleEntry
  machines: Machine[]
  onSave: (data: {
    employee_id: string
    date: string
    shift: number
    start_time: string
    end_time: string
    machine_id: string | null
    applyTo: 'day' | 'week' | 'custom'
    selectedDays?: string[]
  }) => void
  onDelete?: (entryId: string) => void
}

const SHIFT_DEFAULTS: Record<number, { start: string; end: string }> = {
  1: { start: '07:00', end: '17:30' },
  2: { start: '17:30', end: '04:30' },
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export function ShiftAssignModal({
  open,
  onClose,
  employeeId,
  employeeName,
  employeeDefaultShift,
  date,
  weekMonday,
  existing,
  machines,
  onSave,
  onDelete,
}: ShiftAssignModalProps) {
  const { t, language } = useI18n()

  // Use employee's default shift, or existing entry's shift, or fallback to 1
  const defaultShift = existing?.shift ?? employeeDefaultShift ?? 1

  const [shift, setShift] = useState(defaultShift)
  const [startTime, setStartTime] = useState(existing?.start_time ?? SHIFT_DEFAULTS[defaultShift].start)
  const [endTime, setEndTime] = useState(existing?.end_time ?? SHIFT_DEFAULTS[defaultShift].end)
  const [machineId, setMachineId] = useState<string>(existing?.machine_id ?? '')
  const [machineSearch, setMachineSearch] = useState('')
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (open) {
      const s = existing?.shift ?? employeeDefaultShift ?? 1
      setShift(s)
      setStartTime(existing?.start_time ?? SHIFT_DEFAULTS[s].start)
      setEndTime(existing?.end_time ?? SHIFT_DEFAULTS[s].end)
      setMachineId(existing?.machine_id ?? '')
      setMachineSearch('')
      // Pre-select the clicked day
      const dayOfWeek = date.getDay()
      const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // Convert to Mon=0
      setSelectedDays(new Set([dayIndex]))
    }
  }, [open, existing, employeeDefaultShift, date])

  const handleShiftChange = (val: string) => {
    const s = parseInt(val, 10)
    setShift(s)
    setStartTime(SHIFT_DEFAULTS[s].start)
    setEndTime(SHIFT_DEFAULTS[s].end)
  }

  const toggleDay = (dayIndex: number) => {
    setSelectedDays((prev) => {
      const next = new Set(prev)
      if (next.has(dayIndex)) next.delete(dayIndex)
      else next.add(dayIndex)
      return next
    })
  }

  const selectWeekdays = () => {
    setSelectedDays(new Set([0, 1, 2, 3, 4])) // Mon-Fri
  }

  const selectAll = () => {
    setSelectedDays(new Set([0, 1, 2, 3, 4, 5, 6]))
  }

  const handleSave = () => {
    // Build list of dates from selected days
    const dates: string[] = []
    selectedDays.forEach((dayIndex) => {
      const d = new Date(weekMonday)
      d.setDate(d.getDate() + dayIndex)
      dates.push(d.toISOString().split('T')[0])
    })

    if (dates.length === 0) return

    if (dates.length === 1) {
      onSave({
        employee_id: employeeId,
        date: dates[0],
        shift,
        start_time: startTime,
        end_time: endTime,
        machine_id: machineId || null,
        applyTo: 'day',
      })
    } else {
      onSave({
        employee_id: employeeId,
        date: dates[0],
        shift,
        start_time: startTime,
        end_time: endTime,
        machine_id: machineId || null,
        applyTo: 'custom',
        selectedDays: dates,
      })
    }
    onClose()
  }

  const handleDelete = () => {
    if (existing?.id && onDelete) {
      onDelete(existing.id)
      onClose()
    }
  }

  const dateStr = date.toLocaleDateString(language === 'es' ? 'es-US' : 'en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Indiana/Indianapolis',
  })

  const filteredMachines = machines.filter((m) =>
    m.name.toLowerCase().includes(machineSearch.toLowerCase())
  )

  // Day labels
  const dayLabels = language === 'es'
    ? ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-background border-border text-foreground max-w-md">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {existing ? t('scheduling.edit') : t('scheduling.assignShift')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{employeeName} — {dateStr}</p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Shift select */}
          <div className="space-y-2">
            <Label className="text-foreground/80">{t('scheduling.dayShift')} / {t('scheduling.nightShift')}</Label>
            <Select value={String(shift)} onValueChange={handleShiftChange}>
              <SelectTrigger className="bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                <SelectItem value="1" className="text-foreground">{t('scheduling.shift1')}</SelectItem>
                <SelectItem value="2" className="text-foreground">{t('scheduling.shift2')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Time pickers */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-foreground/80">{t('scheduling.startTime')}</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">{t('scheduling.endTime')}</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>

          {/* Machine dropdown with search */}
          <div className="space-y-2">
            <Label className="text-foreground/80">{t('scheduling.machine')}</Label>
            <Input
              placeholder={t('scheduling.selectMachine')}
              value={machineSearch}
              onChange={(e) => setMachineSearch(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground mb-1"
            />
            <Select value={machineId || 'none'} onValueChange={(v) => setMachineId(v === 'none' ? '' : v)}>
              <SelectTrigger className="bg-muted border-border text-foreground">
                <SelectValue placeholder={t('scheduling.selectMachine')} />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border max-h-48">
                <SelectItem value="none" className="text-muted-foreground">— {t('scheduling.selectMachine')} —</SelectItem>
                {filteredMachines.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-foreground">{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Apply to — Day checkboxes */}
          <div className="space-y-2">
            <Label className="text-foreground/80">{t('scheduling.applyTo')}</Label>
            <div className="flex gap-1.5 flex-wrap">
              {dayLabels.map((label, idx) => {
                const isSelected = selectedDays.has(idx)
                const isWeekend = idx >= 5
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      isSelected
                        ? 'bg-blue-600 text-white border-blue-500'
                        : isWeekend
                          ? 'bg-muted/50 text-muted-foreground border-border hover:bg-accent'
                          : 'bg-muted text-foreground/80 border-border hover:bg-accent'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2 mt-1">
              <Button variant="outline" size="sm" onClick={selectWeekdays} className="text-xs border-border h-7">
                {language === 'es' ? 'Lun-Vie' : 'Mon-Fri'}
              </Button>
              <Button variant="outline" size="sm" onClick={selectAll} className="text-xs border-border h-7">
                {language === 'es' ? 'Todos' : 'All'}
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:justify-between">
          {existing?.id && onDelete && (
            <Button variant="destructive" onClick={handleDelete} className="mr-auto">
              {t('scheduling.removeShift')}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="border-border text-foreground/80 hover:bg-accent">
              {t('scheduling.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={selectedDays.size === 0}
              className="bg-blue-600 hover:bg-blue-700 text-foreground"
            >
              {t('scheduling.assignShift')} {selectedDays.size > 1 && `(${selectedDays.size} ${language === 'es' ? 'días' : 'days'})`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
