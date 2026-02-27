'use client'

import { useState, useMemo } from 'react'
import { useI18n } from '@/lib/i18n'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable } from '@/components/data-table'
import { useDataTable, type ColumnDef } from '@/lib/use-data-table'
import { useScheduleAudit, type AuditLogEntry } from '@/hooks/useScheduling'
import { PageSkeleton } from '@/components/ui/skeleton-loader'

interface AuditRow {
  id: string
  datetime: string
  datetime_raw: string
  employee: string
  employee_id: string
  action: string
  action_raw: string
  changed_by: string
  details: string
  [key: string]: unknown
}

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  update: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  delete: 'bg-red-500/20 text-red-400 border-red-500/30',
  copy_week: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  revert_week: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

interface AuditLogViewerProps {
  employees: { employee_id: string; first_name: string; last_name: string }[]
}

export function AuditLogViewer({ employees }: AuditLogViewerProps) {
  const { t } = useI18n()

  // Filters
  const [filterEmployee, setFilterEmployee] = useState<string>('')
  const [filterAction, setFilterAction] = useState<string>('')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')

  const { data, loading } = useScheduleAudit({
    employee_id: filterEmployee || undefined,
    action: filterAction || undefined,
    from: filterFrom || undefined,
    to: filterTo || undefined,
    limit: 500,
  })

  // Build employee lookup
  const empMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees) {
      map.set(e.employee_id, `${e.first_name} ${e.last_name}`)
    }
    return map
  }, [employees])

  // Transform data to flat rows
  const rows: AuditRow[] = useMemo(() => {
    return data.map((entry: AuditLogEntry) => {
      const empName = empMap.get(entry.employee_id) || entry.employee_id

      // Build details string
      let details = ''
      if (entry.field_changed) {
        details = `${entry.field_changed}: ${entry.old_value || '—'} → ${entry.new_value || '—'}`
      } else if (entry.action === 'copy_week' && entry.metadata) {
        const meta = entry.metadata as Record<string, string>
        details = meta.sourceMonday && meta.targetMonday
          ? `${meta.sourceMonday} → ${meta.targetMonday}`
          : entry.new_value || ''
      } else if (entry.new_value) {
        details = entry.new_value
      }

      const dt = new Date(entry.created_at)

      return {
        id: entry.id,
        datetime: dt.toLocaleString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
          hour: 'numeric', minute: '2-digit', hour12: true,
        }),
        datetime_raw: entry.created_at,
        employee: empName,
        employee_id: entry.employee_id,
        action: entry.action,
        action_raw: entry.action,
        changed_by: entry.changed_by_email || entry.changed_by || '—',
        details,
      }
    })
  }, [data, empMap])

  const columns: ColumnDef<AuditRow>[] = useMemo(() => [
    { key: 'datetime', label: t('scheduling.auditDateTime'), sortable: true },
    { key: 'employee', label: t('scheduling.employee'), sortable: true, filterable: true },
    {
      key: 'action',
      label: t('scheduling.auditAction'),
      sortable: true,
      filterable: true,
      render: (_v, row) => (
        <Badge variant="secondary" className={ACTION_COLORS[row.action_raw] || ''}>
          {t(`scheduling.auditAction_${row.action_raw}` as any) || row.action_raw}
        </Badge>
      ),
    },
    { key: 'changed_by', label: t('scheduling.auditChangedBy'), sortable: true, filterable: true },
    { key: 'details', label: t('scheduling.auditDetails'), sortable: false },
  ], [t])

  const table = useDataTable({
    data: rows,
    columns,
    storageKey: 'scheduling-audit-log',
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('scheduling.employee')}</Label>
          <Select value={filterEmployee || 'all'} onValueChange={(v) => setFilterEmployee(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[200px] bg-muted border-border text-foreground">
              <SelectValue placeholder={t('scheduling.auditAllEmployees')} />
            </SelectTrigger>
            <SelectContent className="bg-background border-border max-h-60">
              <SelectItem value="all">{t('scheduling.auditAllEmployees')}</SelectItem>
              {employees
                .filter((e) => e.first_name) // skip blanks
                .sort((a, b) => a.last_name.localeCompare(b.last_name))
                .map((e) => (
                  <SelectItem key={e.employee_id} value={e.employee_id}>
                    {e.last_name}, {e.first_name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('scheduling.auditAction')}</Label>
          <Select value={filterAction || 'all'} onValueChange={(v) => setFilterAction(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-[180px] bg-muted border-border text-foreground">
              <SelectValue placeholder={t('scheduling.auditAllActions')} />
            </SelectTrigger>
            <SelectContent className="bg-background border-border">
              <SelectItem value="all">{t('scheduling.auditAllActions')}</SelectItem>
              <SelectItem value="create">{t('scheduling.auditAction_create')}</SelectItem>
              <SelectItem value="update">{t('scheduling.auditAction_update')}</SelectItem>
              <SelectItem value="delete">{t('scheduling.auditAction_delete')}</SelectItem>
              <SelectItem value="copy_week">{t('scheduling.auditAction_copy_week')}</SelectItem>
              <SelectItem value="revert_week">{t('scheduling.auditAction_revert_week')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('scheduling.auditFrom')}</Label>
          <Input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="w-[160px] bg-muted border-border text-foreground"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t('scheduling.auditTo')}</Label>
          <Input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="w-[160px] bg-muted border-border text-foreground"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <PageSkeleton statCards={0} tableRows={8} />
      ) : (
        <DataTable
          table={table}
          data={rows}
          noun={t('scheduling.auditEntries')}
          exportFilename="audit-log"
          page="scheduling-audit"
          getRowKey={(row) => (row as AuditRow).id}
        />
      )}
    </div>
  )
}
