'use client'

import { useEffect, useState, useCallback } from 'react'
import { Pencil, Trash2, History, PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
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

  const { profile, user } = useAuth()
  const [receiveDate, setReceiveDate] = useState(row.received_date ?? '')
  const [marking, setMarking] = useState(false)
  const receiverName = profile?.full_name || user?.email || ''

  const loadAudit = useCallback(() => {
    fetch(`/api/purchasing/audit?orderId=${row.id}`)
      .then((r) => r.json())
      .then((d) => setAudit(d.entries ?? []))
      .catch(() => setAudit([]))
  }, [row.id])
  useEffect(() => { loadAudit() }, [loadAudit])
  useEffect(() => { setReceiveDate(row.received_date ?? '') }, [row.id, row.received_date])

  // Receive flow: pick a date, then confirm. Does NOT auto-mark; warns if there's
  // no item/paperwork photo (can be bypassed). Records the current user as received-by.
  const markReceived = async () => {
    if (!onQuickPatch || marking) return
    setMarking(true)
    try {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const date = receiveDate || `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      let item = 0, paperwork = 0, checked = false
      try {
        const r = await fetch(`/api/purchasing/${row.id}/photos`)
        if (r.ok) {
          const j = await r.json()
          if (Array.isArray(j.photos)) {
            checked = true
            for (const p of j.photos) { if (p.kind === 'paperwork') paperwork++; else item++ }
          }
        }
      } catch { /* couldn't verify photos — don't show a false "missing photo" warning */ }
      const missing: string[] = []
      if (checked && item === 0) missing.push(t('purchasing.receive.item'))
      if (checked && paperwork === 0) missing.push(t('purchasing.receive.paperwork'))
      if (missing.length > 0 && !window.confirm(t('purchasing.receive.confirmNoPhoto').replace('{what}', missing.join(' + ')))) {
        return
      }
      const input: Record<string, unknown> = { received_date: date }
      if (receiverName) input.received_by = receiverName
      await onQuickPatch(row, input)
    } finally {
      setMarking(false)
    }
  }

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

      <PhotoGallery orderId={row.id} kind="item" title={t('purchasing.photos.itemTitle')} canEdit={canEdit} onChange={loadAudit} />
      <PhotoGallery orderId={row.id} kind="paperwork" title={t('purchasing.photos.paperworkTitle')} canEdit={canEdit} onChange={loadAudit} />

      {canEdit && onQuickPatch && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <PackageCheck className="size-3.5" />{t('purchasing.receive.title')}
          </span>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[170px]">
              <span className="text-[11px] text-muted-foreground">{t('purchasing.col.receivedDate')}</span>
              <DatePicker value={receiveDate} onChange={setReceiveDate} />
            </div>
            <Button size="sm" onClick={markReceived} disabled={marking}>
              <PackageCheck className="mr-1.5 size-3.5" />{t('purchasing.receive.mark')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t('purchasing.receive.hint')}</p>
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
