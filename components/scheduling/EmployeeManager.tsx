'use client'

import { useState, useMemo } from 'react'
import { useI18n } from '@/lib/i18n'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Search, Pencil, UserCheck, UserX } from 'lucide-react'

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

interface EmployeeManagerProps {
  employees: Employee[]
  onUpdate: (id: string, data: Partial<Employee>) => Promise<void>
}

export function EmployeeManager({ employees, onUpdate }: EmployeeManagerProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState<Partial<Employee>>({})
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    let list = showInactive ? employees : employees.filter((e) => e.is_active !== false)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          e.first_name.toLowerCase().includes(q) ||
          e.last_name.toLowerCase().includes(q) ||
          e.employee_id.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => a.last_name.localeCompare(b.last_name))
  }, [employees, search, showInactive])

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={t('scheduling.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-muted border-border text-foreground"
          />
        </div>
        <Button
          variant={showInactive ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowInactive(!showInactive)}
          className="border-border"
        >
          {showInactive ? t('scheduling.hideInactive') : t('scheduling.showInactive')}
          <Badge variant="secondary" className="ml-2">
            {employees.filter((e) => !e.is_active).length}
          </Badge>
        </Button>
      </div>

      {/* Count */}
      <p className="text-sm text-muted-foreground">
        {t('scheduling.showing')} {filtered.length} {t('scheduling.employees').toLowerCase()}
      </p>

      {/* Table */}
      <div className="rounded-md border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-muted-foreground">ID</TableHead>
              <TableHead className="text-muted-foreground">{t('scheduling.employee')}</TableHead>
              <TableHead className="text-muted-foreground">{t('scheduling.department')}</TableHead>
              <TableHead className="text-muted-foreground text-center">{t('scheduling.dayShift')}</TableHead>
              <TableHead className="text-muted-foreground text-right">{t('scheduling.payRate')}</TableHead>
              <TableHead className="text-muted-foreground text-center">{t('scheduling.active')}</TableHead>
              <TableHead className="text-muted-foreground text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((emp) => (
              <TableRow key={emp.id} className={`border-border/50 hover:bg-muted/50 ${!emp.is_active ? 'opacity-50' : ''}`}>
                <TableCell className="text-foreground font-mono text-xs">{emp.employee_id}</TableCell>
                <TableCell className="text-foreground font-medium">{emp.last_name}, {emp.first_name}</TableCell>
                <TableCell className="text-foreground/80">{emp.department}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={emp.default_shift === 1 ? 'default' : 'secondary'} className={emp.default_shift === 1 ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-purple-500/20 text-purple-400 border-purple-500/30'}>
                    {emp.default_shift === 1 ? t('scheduling.shift1') : t('scheduling.shift2')}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-foreground/80">
                  {emp.pay_rate != null ? `$${Number(emp.pay_rate).toFixed(2)}` : '—'}
                </TableCell>
                <TableCell className="text-center">
                  {emp.is_active ? (
                    <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{t('scheduling.active')}</Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-red-500/20 text-red-400 border-red-500/30">{t('scheduling.inactive')}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(emp)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleActive(emp)} className={`h-7 w-7 p-0 ${emp.is_active ? 'text-red-400 hover:text-red-300' : 'text-emerald-400 hover:text-emerald-300'}`}>
                      {emp.is_active ? <UserX className="size-3.5" /> : <UserCheck className="size-3.5" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingEmployee} onOpenChange={(o) => !o && setEditingEmployee(null)}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>{t('scheduling.edit')} — {editingEmployee?.first_name} {editingEmployee?.last_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-foreground/80">First Name</Label>
                <Input value={editForm.first_name || ''} onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })} className="bg-muted border-border text-foreground" />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">Last Name</Label>
                <Input value={editForm.last_name || ''} onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })} className="bg-muted border-border text-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">{t('scheduling.department')}</Label>
              <Select value={editForm.department || 'Molding'} onValueChange={(v) => setEditForm({ ...editForm, department: v })}>
                <SelectTrigger className="bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
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
                <Select value={String(editForm.default_shift || 1)} onValueChange={(v) => setEditForm({ ...editForm, default_shift: parseInt(v) })}>
                  <SelectTrigger className="bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem value="1">{t('scheduling.shift1')}</SelectItem>
                    <SelectItem value="2">{t('scheduling.shift2')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground/80">{t('scheduling.payRate')}</Label>
                <Input type="number" step="0.01" value={editForm.pay_rate ?? ''} onChange={(e) => setEditForm({ ...editForm, pay_rate: e.target.value ? parseFloat(e.target.value) : undefined })} className="bg-muted border-border text-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/80">Shift Length (hours)</Label>
              <Input type="number" value={editForm.shift_length ?? 10} onChange={(e) => setEditForm({ ...editForm, shift_length: parseFloat(e.target.value) })} className="bg-muted border-border text-foreground" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEmployee(null)} className="border-border">{t('scheduling.cancel')}</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? '...' : t('scheduling.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
