'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/lib/i18n'
import { deriveDepartment } from '@/lib/purchasing/compute'
import type { PurchasingInput, PurchasingOrder } from '@/lib/purchasing/types'

type FieldType = 'text' | 'number' | 'date' | 'url' | 'textarea'

const TEXT_FIELDS: { key: keyof PurchasingInput; tKey: string; type: FieldType }[] = [
  { key: 'item_description', tKey: 'purchasing.col.itemDescription', type: 'text' },
  { key: 'quantity', tKey: 'purchasing.col.quantity', type: 'number' },
  { key: 'total_cost', tKey: 'purchasing.col.totalCost', type: 'number' },
  { key: 'delivery_cost', tKey: 'purchasing.col.deliveryCost', type: 'number' },
  { key: 'requestor', tKey: 'purchasing.col.requestor', type: 'text' },
  { key: 'deliver_to', tKey: 'purchasing.col.deliverTo', type: 'text' },
  { key: 'sub_department', tKey: 'purchasing.col.subDepartment', type: 'text' },
  { key: 'department', tKey: 'purchasing.col.department', type: 'text' },
  { key: 'store', tKey: 'purchasing.col.store', type: 'text' },
  { key: 'supplier_link', tKey: 'purchasing.col.supplierLink', type: 'url' },
  { key: 'external_number', tKey: 'purchasing.col.externalNumber', type: 'text' },
  { key: 'date_requested', tKey: 'purchasing.col.dateRequested', type: 'date' },
  { key: 'date_ordered', tKey: 'purchasing.col.dateOrdered', type: 'date' },
  { key: 'promised_date', tKey: 'purchasing.col.promisedDate', type: 'date' },
  { key: 'received_date', tKey: 'purchasing.col.receivedDate', type: 'date' },
  { key: 'received_by', tKey: 'purchasing.col.receivedBy', type: 'text' },
  { key: 'poe_cc', tKey: 'purchasing.col.poeCc', type: 'text' },
]

const BOOL_FIELDS: { key: keyof PurchasingInput; tKey: string }[] = [
  { key: 'urgent', tKey: 'purchasing.col.urgent' },
  { key: 'partial_delivery', tKey: 'purchasing.col.partialDelivery' },
  { key: 'canceled', tKey: 'purchasing.col.canceled' },
  { key: 'refunded', tKey: 'purchasing.col.refunded' },
]

function initialState(order?: PurchasingOrder | null): Record<string, string | boolean> {
  const s: Record<string, string | boolean> = {}
  for (const f of TEXT_FIELDS) {
    const v = order ? order[f.key as keyof PurchasingOrder] : null
    s[f.key] = v == null ? '' : String(v)
  }
  for (const f of BOOL_FIELDS) s[f.key] = order ? Boolean(order[f.key as keyof PurchasingOrder]) : false
  s.notes = order?.notes ?? ''
  return s
}

export function PurchasingForm({
  order,
  onSubmit,
  onCancel,
  submitting,
}: {
  order?: PurchasingOrder | null
  onSubmit: (input: PurchasingInput) => void
  onCancel: () => void
  submitting?: boolean
}) {
  const { t } = useI18n()
  const [state, setState] = useState<Record<string, string | boolean>>(() => initialState(order))
  const set = (k: string, v: string | boolean) => setState((p) => ({ ...p, [k]: v }))

  const suggestedDept = useMemo(
    () => deriveDepartment(String(state.sub_department || '')),
    [state.sub_department]
  )

  const handleSubmit = () => {
    const input: Record<string, unknown> = {}
    for (const f of TEXT_FIELDS) input[f.key] = state[f.key]
    for (const f of BOOL_FIELDS) input[f.key] = state[f.key]
    input.notes = state.notes
    onSubmit(input as PurchasingInput)
  }

  const itemMissing = !String(state.item_description || '').trim()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <div key={f.key} className={f.key === 'item_description' ? 'sm:col-span-2' : ''}>
            <Label htmlFor={`pf-${f.key}`} className="text-xs text-muted-foreground">
              {t(f.tKey)}
              {f.key === 'item_description' && <span className="text-destructive"> *</span>}
            </Label>
            <Input
              id={`pf-${f.key}`}
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              value={String(state[f.key] ?? '')}
              onChange={(e) => set(f.key, e.target.value)}
              className="mt-1 h-9"
              placeholder={f.key === 'department' && suggestedDept ? suggestedDept : undefined}
            />
            {f.key === 'department' && suggestedDept && !String(state.department || '').trim() && (
              <button
                type="button"
                onClick={() => set('department', suggestedDept)}
                className="mt-1 text-[11px] text-primary hover:underline"
              >
                {t('purchasing.useSuggested')}: {suggestedDept}
              </button>
            )}
          </div>
        ))}
      </div>

      <div>
        <Label htmlFor="pf-notes" className="text-xs text-muted-foreground">{t('purchasing.col.notes')}</Label>
        <textarea
          id="pf-notes"
          value={String(state.notes ?? '')}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="flex flex-wrap gap-4">
        {BOOL_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={Boolean(state[f.key])}
              onCheckedChange={(v) => set(f.key, v === true)}
            />
            {t(f.tKey)}
          </label>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={submitting}>{t('ui.cancel')}</Button>
        <Button onClick={handleSubmit} disabled={submitting || itemMissing}>
          {submitting ? t('ui.saving') : t('ui.save')}
        </Button>
      </div>
    </div>
  )
}
