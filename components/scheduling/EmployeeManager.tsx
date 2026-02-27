'use client'

import { useState, useMemo } from 'react'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { Pencil, UserCheck, UserX } from 'lucide-react'

interface Employee {
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

// Flat row type for DataTable (needs string values for filtering)
interface EmployeeRow {
  id: string
  employee_id: string
  name: string
  first_name: string
  last_name: string
  department: string
  shift: string
  default_shift: number
  shift_length: number
  pay_rate: string
  hourly_rate: string
  status: string
  is_active: boolean
  actions: string
  [key: string]: unknown
}

interface EmployeeManagerProps {
  employees: Employee[]
  onUpdate: (id: string, data: Partial<Employee>) => Promise<void>
}

export function EmployeeManager({ employees, onUpdate }: EmployeeManagerProps) {
  const { t } = useI18n()
  const [showInactive, setShowInactive] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState<Partial<Employee>>({})
  const [saving, setSaving] = useState(false)

  // Transform employees into flat rows for DataTable
  const rows: EmployeeRow[] = useMemo(() => {
    const list = showInactive ? employees : employees.filter((e) => e.is_active !== false)
    return list
      .sort((a, b) => a.last_name.localeCompare(b.last_name))
      .map((emp) => ({
        id: emp.id,
        employee_id: emp.employee_id,
        name: `${emp.last_name}, ${emp.first_name}`,
        first_name: emp.first_name,
        last_name: emp.last_name,
        department: emp.department,
        shift: emp.default_shift === 1 ? t('scheduling.shift1') : t('scheduling.shift2'),
        shift_length: emp.shift_length,
        pay_rate: emp.pay_rate != null ? `$${Number(emp.pay_rate).toFixed(2)}` : '—',
        hourly_rate: emp.pay_rate != null ? `$${Number(emp.pay_rate).toFixed(2)}/hr` : '—',
        status: emp.is_active ? t('scheduling.active') : t('scheduling.inactive'),
        is_active: emp.is_active,
        default_shift: emp.default_shift,
        actions: emp.id,
      }))
  }, [employees, showInactive, t])

  const columns: ColumnDef<EmployeeRow>[] = useMemo(
    () => [
      { key: 'employee_id', label: 'ID', sortable: true },
      { key: 'name', label: t('scheduling.employee'), sortable: true },
      { key: 'department', label: t('scheduling.department'), sortable: true, filterable: true },
      {
        key: 'shift',
        label: t('scheduling.dayShift'),
        sortable: true,
        filterable: true,
        render: (_v, row) => (
          <Badge
            variant="secondary"
            className={
              row.default_shift === 1
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
            }
          >
            {row.shift}
          </Badge>
        ),
      },
      { key: 'shift_length', label: 'Shift Length', sortable: true, defaultHidden: true },
      {
        key: 'hourly_rate',
        label: t('scheduling.payRate'),
        sortable: true,
        render: (_v, row) => (
          <span className="font-mono">{row.pay_rate}</span>
        ),
      },
      {
        key: 'status',
        label: t('scheduling.active'),
        sortable: true,
        filterable: true,
        render: (_v, row) =>
          row.is_active ? (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              {t('scheduling.active')}
            </Badge>
          ) : (
            <Badge variant="secondary" className="bg-red-500/20 text-red-400 border-red-500/30">
              {t('scheduling.inactive')}
            </Badge>
          ),
      },
      {
        key: 'actions',
        label: '',
        render: (_v, row) => {
          const emp = employees.find((e) => e.id === row.id)
          if (!emp) return null
          return (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  handleEdit(emp)
                }}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  handleToggleActive(emp)
                }}
                className={`h-7 w-7 p-0 ${emp.is_active ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'}`}
              >
                {emp.is_active ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
              </Button>
            </div>
          )
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, employees]
  )

  const table = useDataTable({
    data: rows,
    columns,
    storageKey: 'scheduling-employees',
  })

  const handleEdit = (emp: Employee) => {
    setEditingEmployee(emp)
    setEditForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      department: emp.department,
      default_shift: emp.default_shift,
      shift_length: emp.shift_length,
      pay_rate: emp.pay_rate,
      is_active: emp.is_active,
    })
  }

  const handleSave = async () => {
    if (!editingEmployee) return
    setSaving(true)
    try {
      await onUpdate(editingEmployee.id, editForm)
      setEditingEmployee(null)
    } catch (err) {
      console.error('Failed to update employee:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (emp: Employee) => {
    await onUpdate(emp.id, { is_active: !emp.is_active })
  }

  const inactiveCount = employees.filter((e) => !e.is_active).length

  return (
    <div className="space-y-4">
      {/* Show inactive toggle */}
      <div className="flex items-center gap-3">
        <Button
          variant={showInactive ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowInactive(!showInactive)}
          className="border-border"
        >
          {showInactive ? t('scheduling.hideInactive') : t('scheduling.showInactive')}
          <Badge variant="secondary" className="ml-2">
            {inactiveCount}
          </Badge>
        </Button>
      </div>

      {/* DataTable with full features */}
      <DataTable
        table={table}
        data={rows}
        noun={t('scheduling.employees').toLowerCase()}
        exportFilename="employees"
        page="scheduling-employees"
        getRowKey={(row) => (row as EmployeeRow).id}
      />

      {/* Edit dialog */}
      <Dialog open={!!editingEmployee} onOpenChange={(o) => !o && setEditingEmployee(null)}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('scheduling.edit')} — {editingEmployee?.first_name} {editingEmployee?.last_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-foreground/80">First Name</Label>
                <Input
                  value={editForm.first_name || ''}
                  onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">Last Name</Label>
                <Input
                  value={editForm.last_name || ''}
                  onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                  className="bg-muted border-border text-foreground"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">{t('scheduling.department')}</Label>
              <Select
                value={editForm.department || 'Molding'}
                onValueChange={(v) => setEditForm({ ...editForm, department: v })}
              >
                <SelectTrigger className="bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="Molding">Molding</SelectItem>
                  <SelectItem value="Ingot Line">Ingot Line</SelectItem>
                  <SelectItem value="Shipping">Shipping</SelectItem>
                  <SelectItem value="Rubberized Applications">Rubberized Applications</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-foreground/80">{t('scheduling.dayShift')}</Label>
                <Select
                  value={String(editForm.default_shift || 1)}
                  onValueChange={(v) => setEditForm({ ...editForm, default_shift: parseInt(v) })}
                >
                  <SelectTrigger className="bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem value="1">{t('scheduling.shift1')}</SelectItem>
                    <SelectItem value="2">{t('scheduling.shift2')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">{t('scheduling.payRate')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.pay_rate ?? ''}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      pay_rate: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  className="bg-muted border-border text-foreground"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Shift Length (hours)</Label>
              <Input
                type="number"
                value={editForm.shift_length ?? 10}
                onChange={(e) => setEditForm({ ...editForm, shift_length: parseFloat(e.target.value) })}
                className="bg-muted border-border text-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEmployee(null)} className="border-border">
              {t('scheduling.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving ? '...' : t('scheduling.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
