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
  date: Date
  existing?: ScheduleEntry
  machines: Machine[]
  onSave: (data: {
    employee_id: string
    date: string
    shift: number
    start_time: string
    end_time: string
    machine_id: string | null
    applyTo: 'day' | 'onward' | 'week'
  }) => void
  onDelete?: (entryId: string) => void
}

const SHIFT_DEFAULTS: Record<number, { start: string; end: string }> = {
  1: { start: '07:00', end: '17:30' },
  2: { start: '17:30', end: '04:30' },
}

export function ShiftAssignModal({
  open,
  onClose,
  employeeId,
  employeeName,
  date,
  existing,
  machines,
  onSave,
  onDelete,
}: ShiftAssignModalProps) {
  const { t } = useI18n()
  const [shift, setShift] = useState(existing?.shift ?? 1)
  const [startTime, setStartTime] = useState(existing?.start_time ?? SHIFT_DEFAULTS[1].start)
  const [endTime, setEndTime] = useState(existing?.end_time ?? SHIFT_DEFAULTS[1].end)
  const [machineId, setMachineId] = useState<string>(existing?.machine_id ?? '')
  const [applyTo, setApplyTo] = useState<'day' | 'onward' | 'week'>('day')
  const [machineSearch, setMachineSearch] = useState('')

  useEffect(() => {
    if (open) {
      const s = existing?.shift ?? 1
      setShift(s)
      setStartTime(existing?.start_time ?? SHIFT_DEFAULTS[s].start)
      setEndTime(existing?.end_time ?? SHIFT_DEFAULTS[s].end)
      setMachineId(existing?.machine_id ?? '')
      setApplyTo('day')
      setMachineSearch('')
    }
  }, [open, existing])

  const handleShiftChange = (val: string) => {
    const s = parseInt(val, 10)
    setShift(s)
    setStartTime(SHIFT_DEFAULTS[s].start)
    setEndTime(SHIFT_DEFAULTS[s].end)
  }

  const handleSave = () => {
    onSave({
      employee_id: employeeId,
      date: date.toISOString().split('T')[0],
      shift,
      start_time: startTime,
      end_time: endTime,
      machine_id: machineId || null,
      applyTo,
    })
    onClose()
  }

  const handleDelete = () => {
    if (existing?.id && onDelete) {
      onDelete(existing.id)
      onClose()
    }
  }

  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Indiana/Indianapolis',
  })

  const filteredMachines = machines.filter((m) =>
    m.name.toLowerCase().includes(machineSearch.toLowerCase())
  )

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

          {/* Apply to */}
          <div className="space-y-2">
            <Label className="text-foreground/80">{t('scheduling.applyTo')}</Label>
            <Select value={applyTo} onValueChange={(v) => setApplyTo(v as 'day' | 'onward' | 'week')}>
              <SelectTrigger className="bg-muted border-border text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-muted border-border">
                <SelectItem value="day" className="text-foreground">{t('scheduling.thisDayOnly')}</SelectItem>
                <SelectItem value="onward" className="text-foreground">{t('scheduling.thisDayOnward')}</SelectItem>
                <SelectItem value="week" className="text-foreground">{t('scheduling.entireWeek')}</SelectItem>
              </SelectContent>
            </Select>
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
            <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-foreground">
              {t('scheduling.assignShift')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
