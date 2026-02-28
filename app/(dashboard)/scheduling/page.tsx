'use client'

import { useState, useMemo, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/ui/skeleton-loader'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { CurrentTime } from '@/components/scheduling/CurrentTime'
import { ScheduleSearch } from '@/components/scheduling/ScheduleSearch'
import { ScheduleGrid, type ScheduleEntry, type ScheduleEmployee } from '@/components/scheduling/ScheduleGrid'
import { ShiftAssignModal } from '@/components/scheduling/ShiftAssignModal'
import { MachineManager } from '@/components/scheduling/MachineManager'
import { HoursPayTable } from '@/components/scheduling/HoursPayTable'
import { EmployeeManager } from '@/components/scheduling/EmployeeManager'
import { AuditLogViewer } from '@/components/scheduling/AuditLogViewer'
import { ScheduleExport } from '@/components/scheduling/ScheduleExport'
import {
  useScheduleEntries,
  useScheduleEmployees,
  useScheduleMachines,
  useScheduleHours,
  useScheduleMutations,
} from '@/hooks/useScheduling'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, CalendarDays, Settings, Copy, Undo2, ScrollText } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// --- Week helpers ---
function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function getWeekDates(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function formatDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + 7 * n)
  return r
}

export default function SchedulingPage() {
  const { t } = useI18n()
  const { user, profile } = useAuth()
  const role = profile?.role ?? 'visitor'

  const isAdmin = role === 'admin' || role === 'super_admin' || role === 'manager'
  const canEdit = role === 'admin' || role === 'super_admin' || role === 'manager' || role === 'group_leader'
  const canViewPast = canEdit // admins/managers/group_leaders

  // Week state
  const [weekOffset, setWeekOffset] = useState(0)
  const monday = useMemo(() => addWeeks(getMonday(new Date()), weekOffset), [weekOffset])
  const weekDates = useMemo(() => getWeekDates(monday), [monday])
  const sunday = weekDates[6]

  const from = formatDateStr(monday)
  const to = formatDateStr(sunday)

  // Tab state
  const [activeTab, setActiveTab] = useState<'schedule' | 'hourspay' | 'employees' | 'audit'>('schedule')
  const [shiftFilter, setShiftFilter] = useState<number | null>(null)
  const [departmentFilter, setDepartmentFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Modal state
  const [assignModal, setAssignModal] = useState<{
    open: boolean
    employeeId: string
    employeeName: string
    employeeDefaultShift: number
    date: Date
    existing?: ScheduleEntry
  }>({ open: false, employeeId: '', employeeName: '', employeeDefaultShift: 1, date: new Date() })
  const [machineManagerOpen, setMachineManagerOpen] = useState(false)

  // Data
  const { entries, loading: entriesLoading, refetch: refetchEntries } = useScheduleEntries(from, to, {
    shift: shiftFilter ?? undefined,
  })
  const { employees, loading: employeesLoading } = useScheduleEmployees()
  const { machines, refetch: refetchMachines } = useScheduleMachines()
  const { saveEntry, deleteEntry, addMachine, updateMachine, deleteMachine } = useScheduleMutations()

  // Hours & Pay
  const [hoursFrom, setHoursFrom] = useState(from)
  const [hoursTo, setHoursTo] = useState(to)
  const { data: hoursData, loading: hoursLoading, refetch: refetchHours } = useScheduleHours(hoursFrom, hoursTo)

  // Departments list
  const departments = useMemo(() => {
    const depts = new Set(employees.map((e: ScheduleEmployee) => e.department))
    return Array.from(depts).sort()
  }, [employees])

  // Filter employees
  const filteredEmployees = useMemo(() => {
    let filtered = employees.filter((e: ScheduleEmployee) => e.is_active !== false)
    if (departmentFilter) filtered = filtered.filter((e: ScheduleEmployee) => e.department === departmentFilter)
    if (shiftFilter) filtered = filtered.filter((e: ScheduleEmployee) => e.default_shift === shiftFilter)
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter((e: ScheduleEmployee) =>
        e.first_name.toLowerCase().includes(q) ||
        e.last_name.toLowerCase().includes(q) ||
        e.employee_id.toLowerCase().includes(q)
      )
    }
    return filtered
  }, [employees, departmentFilter, shiftFilter, search])

  // For regular users: filter to only show today+future
  const visibleWeekDates = useMemo(() => {
    if (canViewPast) return weekDates
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return weekDates.filter((d) => d >= today)
  }, [weekDates, canViewPast])

  // Prevent regular users from navigating to past
  const canGoPrev = canViewPast || weekOffset > 0

  // Copy week state
  const [copyLoading, setCopyLoading] = useState(false)
  const [lastCopiedIds, setLastCopiedIds] = useState<string[] | null>(null)
  const [showCopyConfirm, setShowCopyConfirm] = useState(false)

  const handleCellClick = useCallback(
    (employeeId: string, date: Date, existing?: ScheduleEntry) => {
      if (!canEdit) return
      const emp = employees.find((e: ScheduleEmployee) => e.employee_id === employeeId)
      setAssignModal({
        open: true,
        employeeId,
        employeeName: emp ? `${emp.first_name} ${emp.last_name}` : employeeId,
        employeeDefaultShift: emp?.default_shift ?? 1,
        date,
        existing,
      })
    },
    [canEdit, employees]
  )

  const handleSaveEntry = async (data: any) => {
    if (data.applyTo === 'custom' && data.selectedDays?.length > 1) {
      // Save each selected day as separate entry
      for (const dateStr of data.selectedDays) {
        await saveEntry({
          employee_id: data.employee_id,
          date: dateStr,
          shift: data.shift,
          start_time: data.start_time,
          end_time: data.end_time,
          machine_id: data.machine_id,
          applyTo: 'day',
        })
      }
    } else {
      await saveEntry(data)
    }
    refetchEntries()
  }

  // Copy feedback state
  const [copyMessage, setCopyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleCopyWeek = async () => {
    setCopyLoading(true)
    setCopyMessage(null)
    try {
      const prevMonday = addWeeks(monday, -1)
      const resp = await fetch('/api/scheduling/copy-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user?.id || '' },
        body: JSON.stringify({
          sourceMonday: formatDateStr(prevMonday),
          targetMonday: formatDateStr(monday),
        }),
      })
      const result = await resp.json()
      if (!resp.ok) {
        setCopyMessage({ type: 'error', text: result.error || 'Copy failed' })
      } else if (result.copied === 0) {
        setCopyMessage({ type: 'error', text: result.message || result.error || 'No entries to copy' })
      } else {
        setCopyMessage({ type: 'success', text: `✅ Copied ${result.copied} entries` })
        if (result.copiedIds) {
          setLastCopiedIds(result.copiedIds)
        }
      }
      refetchEntries()
    } catch (err) {
      console.error('Copy week failed:', err)
      setCopyMessage({ type: 'error', text: 'Network error — copy failed' })
    } finally {
      setCopyLoading(false)
      setShowCopyConfirm(false)
      // Auto-dismiss success after 5s
      setTimeout(() => setCopyMessage(null), 5000)
    }
  }

  const handleRevertCopy = async () => {
    if (!lastCopiedIds) return
    try {
      await fetch('/api/scheduling/revert-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user?.id || '' },
        body: JSON.stringify({ copiedIds: lastCopiedIds }),
      })
      setLastCopiedIds(null)
      refetchEntries()
    } catch (err) {
      console.error('Revert failed:', err)
    }
  }

  const handleDeleteEntry = async (id: string) => {
    await deleteEntry(id)
    refetchEntries()
  }

  const handleAddMachine = async (data: { name: string; department: string }) => {
    await addMachine(data)
    refetchMachines()
  }

  const handleUpdateMachine = async (id: string, data: Record<string, unknown>) => {
    await updateMachine(id, data)
    refetchMachines()
  }

  const handleDeleteMachine = async (id: string) => {
    await deleteMachine(id)
    refetchMachines()
  }

  const weekLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  const loading = entriesLoading || employeesLoading

  return (
    <div className="p-4 pb-20 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays className="size-6" />
            {t('scheduling.title')}
          </h1>
          <CurrentTime />
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMachineManagerOpen(true)}
              className="border-border text-foreground/80 hover:bg-accent"
            >
              <Settings className="size-4 mr-1" />
              {t('scheduling.manageMachines')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs: Schedule vs Hours & Pay */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'schedule' | 'hourspay' | 'employees' | 'audit')}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <TabsList className="bg-muted border border-border">
            <TabsTrigger value="schedule" className="data-[state=active]:bg-accent text-foreground/80">
              {t('scheduling.title')}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="hourspay" className="data-[state=active]:bg-accent text-foreground/80">
                {t('scheduling.hoursPay')}
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="employees" className="data-[state=active]:bg-accent text-foreground/80">
                {t('scheduling.employees')} ({employees.length})
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="audit" className="data-[state=active]:bg-accent text-foreground/80">
                <ScrollText className="size-4 mr-1" />
                {t('scheduling.auditLog')}
              </TabsTrigger>
            )}
          </TabsList>

          {/* Shift filter tabs */}
          {activeTab === 'schedule' && (
            <div className="flex gap-1">
              <Button
                variant={shiftFilter === null ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShiftFilter(null)}
                className={shiftFilter === null ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'}
              >
                All
              </Button>
              <Button
                variant={shiftFilter === 1 ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShiftFilter(1)}
                className={shiftFilter === 1 ? 'bg-blue-600 text-foreground' : 'text-muted-foreground hover:text-foreground'}
              >
                {t('scheduling.shift1')}
              </Button>
              <Button
                variant={shiftFilter === 2 ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShiftFilter(2)}
                className={shiftFilter === 2 ? 'bg-purple-600 text-foreground' : 'text-muted-foreground hover:text-foreground'}
              >
                {t('scheduling.shift2')}
              </Button>
              <Select value={departmentFilter || 'all'} onValueChange={(v) => setDepartmentFilter(v === 'all' ? null : v)}>
                <SelectTrigger className="w-[180px] bg-muted border-border text-foreground">
                  <SelectValue placeholder={t('scheduling.department')} />
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="all">{t('scheduling.allDepartments')}</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="mt-0">
          {/* Search + Week nav */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <ScheduleSearch value={search} onChange={setSearch} />
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canGoPrev}
                onClick={() => setWeekOffset((w) => w - 1)}
                className="border-border text-foreground/80 hover:bg-accent disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
                <span className="hidden sm:inline ml-1">{t('scheduling.prevWeek')}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekOffset(0)}
                className="border-border text-foreground/80 hover:bg-accent font-medium"
              >
                {weekOffset === 0 ? t('scheduling.thisWeek') : weekLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekOffset((w) => w + 1)}
                className="border-border text-foreground/80 hover:bg-accent"
              >
                <span className="hidden sm:inline mr-1">{t('scheduling.nextWeek')}</span>
                <ChevronRight className="size-4" />
              </Button>
              {canEdit && (
                <>
                  <div className="w-px h-6 bg-border mx-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCopyConfirm(true)}
                    disabled={copyLoading}
                    className="border-border text-foreground/80 hover:bg-accent"
                  >
                    <Copy className="size-4 mr-1" />
                    <span className="hidden sm:inline">{t('scheduling.copyPrevWeek')}</span>
                  </Button>
                  {lastCopiedIds && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRevertCopy}
                      className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                    >
                      <Undo2 className="size-4 mr-1" />
                      <span className="hidden sm:inline">{t('scheduling.revert')}</span>
                    </Button>
                  )}
                </>
              )}
              <div className="w-px h-6 bg-border mx-1" />
              <ScheduleExport
                entries={entries as ScheduleEntry[]}
                employees={filteredEmployees as ScheduleEmployee[]}
                weekDates={visibleWeekDates}
                weekLabel={weekLabel}
              />
            </div>
          </div>

          {/* Week label (when navigated away) */}
          {weekOffset !== 0 && (
            <p className="text-sm text-muted-foreground mb-3">{weekLabel}</p>
          )}

          {/* Copy feedback */}
          {copyMessage && (
            <div className={`mb-3 px-4 py-2 rounded-md text-sm font-medium ${
              copyMessage.type === 'success'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}>
              {copyMessage.text}
            </div>
          )}

          {loading ? (
            <PageSkeleton statCards={0} tableRows={8} />
          ) : (
            <Card className="bg-background border-border overflow-hidden">
              <ScheduleGrid
                entries={entries as ScheduleEntry[]}
                employees={filteredEmployees as ScheduleEmployee[]}
                weekDates={visibleWeekDates}
                canEdit={canEdit}
                onCellClick={handleCellClick}
              />
            </Card>
          )}
        </TabsContent>

        {/* Hours & Pay Tab (admin only) */}
        {isAdmin && (
          <TabsContent value="hourspay" className="mt-0">
            <Card className="bg-background border-border p-4">
              <HoursPayTable
                data={Array.isArray(hoursData) ? hoursData : []}
                loading={hoursLoading}
                dateFrom={hoursFrom}
                dateTo={hoursTo}
                onDateChange={(f, t) => {
                  setHoursFrom(f)
                  setHoursTo(t)
                  refetchHours()
                }}
                showPay={isAdmin}
              />
            </Card>
          </TabsContent>
        )}
        {/* Employees Tab (admin only) */}
        {isAdmin && (
          <TabsContent value="employees" className="mt-0">
            <Card className="bg-background border-border p-4">
              <EmployeeManager
                employees={employees}
                showPay={isAdmin}
                onUpdate={async (id, data) => {
                  await fetch('/api/scheduling/employees', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'x-user-id': user?.id || '' },
                    body: JSON.stringify({ id, ...data }),
                  })
                  window.location.reload()
                }}
              />
            </Card>
          </TabsContent>
        )}
        {/* Audit Log Tab (admin/manager only) */}
        {isAdmin && (
          <TabsContent value="audit" className="mt-0">
            <Card className="bg-background border-border p-4">
              <AuditLogViewer employees={employees} />
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Modals */}
      <ShiftAssignModal
        open={assignModal.open}
        onClose={() => setAssignModal((s) => ({ ...s, open: false }))}
        employeeId={assignModal.employeeId}
        employeeName={assignModal.employeeName}
        employeeDefaultShift={assignModal.employeeDefaultShift}
        date={assignModal.date}
        weekMonday={monday}
        existing={assignModal.existing}
        machines={machines.map((m: any) => ({ id: m.id, name: m.name }))}
        onSave={handleSaveEntry}
        onDelete={handleDeleteEntry}
      />

      <MachineManager
        open={machineManagerOpen}
        onClose={() => setMachineManagerOpen(false)}
        machines={machines}
        onAdd={handleAddMachine}
        onUpdate={handleUpdateMachine}
        onDelete={handleDeleteMachine}
      />

      {/* Copy week confirmation dialog */}
      <Dialog open={showCopyConfirm} onOpenChange={setShowCopyConfirm}>
        <DialogContent className="bg-background border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('scheduling.copyPrevWeek')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('scheduling.copyConfirmMessage')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCopyConfirm(false)} className="border-border">
              {t('scheduling.cancel')}
            </Button>
            <Button onClick={handleCopyWeek} disabled={copyLoading} className="bg-blue-600 hover:bg-blue-700">
              {copyLoading ? '...' : t('scheduling.copyConfirmYes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
