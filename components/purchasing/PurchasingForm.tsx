'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { Combobox } from './Combobox'
import { DatePicker } from './DatePicker'
import type { PurchasingInput, PurchasingOrder } from '@/lib/purchasing/types'

type OptionField = 'department' | 'sub_department' | 'person'
type Control = 'text' | 'number' | 'date' | 'url' | { combo: OptionField }

const FIELDS: { key: keyof PurchasingInput; tKey: string; control: Control; full?: boolean }[] = [
  { key: 'item_description', tKey: 'purchasing.col.itemDescription', control: 'text', full: true },
  { key: 'quantity', tKey: 'purchasing.col.quantity', control: 'number' },
  { key: 'total_cost', tKey: 'purchasing.col.totalCost', control: 'number' },
  { key: 'delivery_cost', tKey: 'purchasing.col.deliveryCost', control: 'number' },
  { key: 'requestor', tKey: 'purchasing.col.requestor', control: { combo: 'person' } },
  { key: 'deliver_to', tKey: 'purchasing.col.deliverTo', control: { combo: 'person' } },
  { key: 'department', tKey: 'purchasing.col.department', control: { combo: 'department' } },
  { key: 'sub_department', tKey: 'purchasing.col.subDepartment', control: { combo: 'sub_department' } },
  { key: 'store', tKey: 'purchasing.col.store', control: 'text' },
  { key: 'supplier_link', tKey: 'purchasing.col.supplierLink', control: 'url' },
  { key: 'external_number', tKey: 'purchasing.col.externalNumber', control: 'text' },
  { key: 'date_requested', tKey: 'purchasing.col.dateRequested', control: 'date' },
  { key: 'date_ordered', tKey: 'purchasing.col.dateOrdered', control: 'date' },
  { key: 'promised_date', tKey: 'purchasing.col.promisedDate', control: 'date' },
  { key: 'received_date', tKey: 'purchasing.col.receivedDate', control: 'date' },
  { key: 'received_by', tKey: 'purchasing.col.receivedBy', control: { combo: 'person' } },
  { key: 'poe_cc', tKey: 'purchasing.col.poeCc', control: 'text' },
]

const BOOL_FIELDS: { key: keyof PurchasingInput; tKey: string }[] = [
  { key: 'urgent', tKey: 'purchasing.col.urgent' },
  { key: 'partial_delivery', tKey: 'purchasing.col.partialDelivery' },
  { key: 'canceled', tKey: 'purchasing.col.canceled' },
  { key: 'refunded', tKey: 'purchasing.col.refunded' },
]

type OptionsMap = Record<OptionField, string[]>

function initialState(order?: PurchasingOrder | null): Record<string, string | boolean> {
  const s: Record<string, string | boolean> = {}
  for (const f of FIELDS) {
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
  const { user } = useAuth()
  const [state, setState] = useState<Record<string, string | boolean>>(() => initialState(order))
  const [options, setOptions] = useState<OptionsMap>({ department: [], sub_department: [], person: [] })
  const set = (k: string, v: string | boolean) => setState((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    fetch('/api/purchasing/options')
      .then((r) => r.json())
      .then((d) => { if (d.options) setOptions(d.options) })
      .catch(() => {})
  }, [])

  // Persist a newly-typed option. Only add it to the shared list when the POST
  // actually succeeds (avoids faking a save). The value is still applied to the
  // field by the Combobox regardless, so this entry saves either way.
  const addOption = useCallback(async (field: OptionField, value: string) => {
    try {
      const res = await fetch('/api/purchasing/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user?.id || '' },
        body: JSON.stringify({ field, value }),
      })
      if (res.ok) {
        setOptions((prev) => (prev[field].includes(value) ? prev : { ...prev, [field]: [...prev[field], value] }))
      }
    } catch { /* value still usable as this field's content */ }
  }, [user?.id])

  const handleSubmit = () => {
    const input: Record<string, unknown> = {}
    for (const f of FIELDS) input[f.key] = state[f.key]
    for (const f of BOOL_FIELDS) input[f.key] = state[f.key]
    input.notes = state.notes
    onSubmit(input as PurchasingInput)
  }

  const itemMissing = !String(state.item_description || '').trim()

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const val = String(state[f.key] ?? '')
          return (
            <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
              <Label htmlFor={`pf-${f.key}`} className="text-xs text-muted-foreground">
                {t(f.tKey)}
                {f.key === 'item_description' && <span className="text-destructive"> *</span>}
              </Label>
              {typeof f.control === 'object' ? (
                <Combobox
                  id={`pf-${f.key}`}
                  value={val}
                  onChange={(v) => set(f.key, v)}
                  options={options[f.control.combo]}
                  onCreate={(v) => addOption((f.control as { combo: OptionField }).combo, v)}
                />
              ) : f.control === 'date' ? (
                <DatePicker id={`pf-${f.key}`} value={val} onChange={(v) => set(f.key, v)} />
              ) : (
                <Input
                  id={`pf-${f.key}`}
                  type={f.control === 'number' ? 'number' : 'text'}
                  inputMode={f.control === 'number' ? 'decimal' : undefined}
                  value={val}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="mt-1 h-9"
                />
              )}
            </div>
          )
        })}
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
