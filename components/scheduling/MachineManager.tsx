'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/lib/i18n'
import { Pencil, Trash2, Plus } from 'lucide-react'

interface Machine {
  id: string
  name: string
  department: string
  is_active: boolean
}

interface MachineManagerProps {
  open: boolean
  onClose: () => void
  machines: Machine[]
  onAdd: (data: { name: string; department: string }) => void
  onUpdate: (id: string, data: Partial<Machine>) => void
  onDelete: (id: string) => void
}

export function MachineManager({ open, onClose, machines, onAdd, onUpdate, onDelete }: MachineManagerProps) {
  const { t } = useI18n()
  const [newName, setNewName] = useState('')
  const [newDept, setNewDept] = useState('Molding')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleAdd = () => {
    if (!newName.trim()) return
    onAdd({ name: newName.trim(), department: newDept })
    setNewName('')
    setNewDept('Molding')
  }

  const startEdit = (m: Machine) => {
    setEditingId(m.id)
    setEditName(m.name)
  }

  const saveEdit = (id: string) => {
    if (editName.trim()) {
      onUpdate(id, { name: editName.trim() })
    }
    setEditingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground">{t('scheduling.manageMachines')}</DialogTitle>
        </DialogHeader>

        {/* Add form */}
        <div className="flex gap-2 items-end border-b border-border pb-4">
          <div className="flex-1 space-y-1">
            <Label className="text-muted-foreground text-xs">{t('scheduling.machineName')}</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('scheduling.machineName')}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <div className="w-28 space-y-1">
            <Label className="text-muted-foreground text-xs">{t('scheduling.department')}</Label>
            <Input
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
              className="bg-muted border-border text-foreground"
            />
          </div>
          <Button onClick={handleAdd} size="sm" className="bg-blue-600 hover:bg-blue-700 shrink-0">
            <Plus className="size-4 mr-1" /> {t('scheduling.addMachine')}
          </Button>
        </div>

        {/* Machine list */}
        <div className="space-y-1">
          {machines.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50 group"
            >
              <Checkbox
                checked={m.is_active}
                onCheckedChange={(checked) => onUpdate(m.id, { is_active: !!checked })}
                className="border-border"
              />
              {editingId === m.id ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => saveEdit(m.id)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEdit(m.id)}
                  className="flex-1 bg-muted border-border text-foreground h-8 text-sm"
                  autoFocus
                />
              ) : (
                <span className={`flex-1 text-sm ${m.is_active ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                  {m.name}
                </span>
              )}
              <span className="text-xs text-muted-foreground">{m.department}</span>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(m)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(m.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:bg-accent"
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
          {machines.length === 0 && (
            <p className="text-center text-muted-foreground py-8 text-sm">{t('scheduling.noSchedule')}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
