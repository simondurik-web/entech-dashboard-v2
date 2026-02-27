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
import {
  useScheduleEntries,
  useScheduleEmployees,
  useScheduleMachines,
  useScheduleHours,
  useScheduleMutations,
} from '@/hooks/useScheduling'
import { ChevronLeft, ChevronRight, CalendarDays, Settings } from 'lucide-react'

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
  const { profile } = useAuth()
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
  const [activeTab, setActiveTab] = useState<'schedule' | 'hourspay'>('schedule')
  const [shiftFilter, setShiftFilter] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  // Modal state
  const [assignModal, setAssignModal] = useState<{
    open: boolean
    employeeId: string
    employeeName: string
    date: Date
    existing?: ScheduleEntry
  }>({ open: false, employeeId: '', employeeName: '', date: new Date() })
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

  // Filter employees by search
  const filteredEmployees = useMemo(() => {
    if (!search) return employees
    const q = search.toLowerCase()
    return employees.filter(
      (e: ScheduleEmployee) =>
        e.first_name.toLowerCase().includes(q) ||
        e.last_name.toLowerCase().includes(q) ||
        e.employee_id.toLowerCase().includes(q)
    )
  }, [employees, search])

  // For regular users: filter to only show today+future
  const visibleWeekDates = useMemo(() => {
    if (canViewPast) return weekDates
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return weekDates.filter((d) => d >= today)
  }, [weekDates, canViewPast])

  // Prevent regular users from navigating to past
  const canGoPrev = canViewPast || weekOffset > 0

  const handleCellClick = useCallback(
    (employeeId: string, date: Date, existing?: ScheduleEntry) => {
      if (!canEdit) return
      const emp = employees.find((e: ScheduleEmployee) => e.employee_id === employeeId)
      setAssignModal({
        open: true,
        employeeId,
        employeeName: emp ? `${emp.first_name} ${emp.last_name}` : employeeId,
        date,
        existing,
      })
    },
    [canEdit, employees]
  )

  const handleSaveEntry = async (data: Parameters<typeof saveEntry>[0]) => {
    await saveEntry(data)
    refetchEntries()
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
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
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
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <Settings className="size-4 mr-1" />
              {t('scheduling.manageMachines')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs: Schedule vs Hours & Pay */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'schedule' | 'hourspay')}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger value="schedule" className="data-[state=active]:bg-zinc-700 text-zinc-300">
              {t('scheduling.title')}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="hourspay" className="data-[state=active]:bg-zinc-700 text-zinc-300">
                {t('scheduling.hoursPay')}
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
                className={shiftFilter === null ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}
              >
                All
              </Button>
              <Button
                variant={shiftFilter === 1 ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShiftFilter(1)}
                className={shiftFilter === 1 ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'}
              >
                {t('scheduling.shift1')}
              </Button>
              <Button
                variant={shiftFilter === 2 ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setShiftFilter(2)}
                className={shiftFilter === 2 ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-white'}
              >
                {t('scheduling.shift2')}
              </Button>
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
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
                <span className="hidden sm:inline ml-1">{t('scheduling.prevWeek')}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekOffset(0)}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 font-medium"
              >
                {weekOffset === 0 ? t('scheduling.thisWeek') : weekLabel}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setWeekOffset((w) => w + 1)}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                <span className="hidden sm:inline mr-1">{t('scheduling.nextWeek')}</span>
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>

          {/* Week label (when navigated away) */}
          {weekOffset !== 0 && (
            <p className="text-sm text-zinc-400 mb-3">{weekLabel}</p>
          )}

          {loading ? (
            <PageSkeleton statCards={0} tableRows={8} />
          ) : (
            <Card className="bg-zinc-950 border-zinc-800 overflow-hidden">
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
            <Card className="bg-zinc-950 border-zinc-800 p-4">
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
              />
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
        date={assignModal.date}
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
    </div>
  )
}
