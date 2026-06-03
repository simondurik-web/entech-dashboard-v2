'use client'

import { useEffect, useState, useCallback } from 'react'
import { Pencil, Trash2, History, PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { DatePicker } from './DatePicker'
import { PhotoGallery } from './PhotoGallery'
import type { PurchasingRow, PurchasingAudit, PurchasingInput } from '@/lib/purchasing/types'

function fmtDate(v: string | null): string {
  if (!v) return '—'
  const d = new Date(v + (v.length === 10 ? 'T00:00:00' : ''))
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString()
}
function fmtDateTime(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

export function PurchasingDetail({
  row,
  onEdit,
  onDelete,
  onQuickPatch,
  canEdit,
}: {
  row: PurchasingRow
  onEdit: (row: PurchasingRow) => void
  onDelete: (row: PurchasingRow) => void
  onQuickPatch?: (row: PurchasingRow, input: PurchasingInput) => Promise<void> | void
  canEdit: boolean
}) {
  const { t } = useI18n()
  const [audit, setAudit] = useState<PurchasingAudit[] | null>(null)

  const loadAudit = useCallback(() => {
    fetch(`/api/purchasing/audit?orderId=${row.id}`)
      .then((r) => r.json())
      .then((d) => setAudit(d.entries ?? []))
      .catch(() => setAudit([]))
  }, [row.id])
  useEffect(() => { loadAudit() }, [loadAudit])

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: t('purchasing.col.externalNumber'), value: row.external_number || '—' },
    { label: t('purchasing.col.requestor'), value: row.requestor || '—' },
    { label: t('purchasing.col.deliverTo'), value: row.deliver_to || '—' },
    { label: t('purchasing.col.subDepartment'), value: row.sub_department || '—' },
    { label: t('purchasing.col.store'), value: row.store || '—' },
    { label: t('purchasing.col.poeCc'), value: row.poe_cc || '—' },
    { label: t('purchasing.col.dateRequested'), value: fmtDate(row.date_requested) },
    { label: t('purchasing.col.dateOrdered'), value: fmtDate(row.date_ordered) },
    { label: t('purchasing.col.promisedDate'), value: fmtDate(row.promised_date) },
    { label: t('purchasing.col.receivedDate'), value: fmtDate(row.received_date) },
    { label: t('purchasing.col.receivedBy'), value: row.received_by || '—' },
    {
      label: t('purchasing.col.supplierLink'),
      value: row.supplier_link
        ? <a href={row.supplier_link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{t('purchasing.openLink')}</a>
        : '—',
    },
    { label: t('purchasing.col.notes'), value: row.notes || '—' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <Button size="sm" variant="outline" onClick={() => onEdit(row)}>
              <Pencil className="mr-1.5 size-3.5" />{t('ui.edit')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onDelete(row)}>
              <Trash2 className="mr-1.5 size-3.5" />{t('ui.delete')}
            </Button>
          </>
        )}
      </div>

      {canEdit && onQuickPatch && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
          <div className="min-w-[180px]">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <PackageCheck className="size-3.5" />{t('purchasing.quickReceived')}
            </span>
            <DatePicker
              value={row.received_date ?? ''}
              onChange={(v) => onQuickPatch(row, { received_date: v || null })}
            />
          </div>
          <p className="pb-2 text-[11px] text-muted-foreground">{t('purchasing.quickReceivedHint')}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
        {fields.map((f, i) => (
          <div key={i}>
            <span className="text-xs text-muted-foreground">{f.label}</span>
            <p className="font-medium break-words">{f.value}</p>
          </div>
        ))}
      </div>

      <PhotoGallery orderId={row.id} canEdit={canEdit} onChange={loadAudit} />

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <History className="size-3.5" />{t('purchasing.auditTrail')}
        </p>
        {audit === null ? (
          <p className="text-xs text-muted-foreground">{t('ui.loading')}</p>
        ) : audit.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('purchasing.noHistory')}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                <span className="text-foreground/80">{fmtDateTime(e.created_at)}</span>
                <span className="font-medium text-foreground">{t(`purchasing.action.${e.action}`)}</span>
                {e.field_name && (
                  <span>
                    {e.field_name}: <span className="line-through">{e.old_value ?? '∅'}</span> → <span className="text-foreground">{e.new_value ?? '∅'}</span>
                  </span>
                )}
                <span className="ml-auto">{e.performed_by_name || e.performed_by_email || '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
