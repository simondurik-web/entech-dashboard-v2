'use client'

import { useState } from 'react'
import { Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import type { ProcessedPo, PoStatus, PoEnteredVia } from '@/lib/po-automation/types'
import type { PoLineItem } from '@/lib/po-automation/edit'

const STATUSES: PoStatus[] = [
  'pending',
  'claimed',
  'processing',
  'entered',
  'failed',
  'skipped_duplicate',
  'manual_override',
]
const VIAS: PoEnteredVia[] = ['data_api', 'codex_ui', 'phil_backup', 'manual']

function toNum(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

interface EditableLine {
  item_number: string
  description: string
  quantity: string
  unit_price: string
}

function payloadLines(po: ProcessedPo): EditableLine[] {
  const payload = (po.payload ?? {}) as Record<string, unknown>
  const items = Array.isArray(payload.line_items) ? (payload.line_items as PoLineItem[]) : []
  return items.map((li) => ({
    item_number: li.item_number != null ? String(li.item_number) : '',
    description: li.description != null ? String(li.description) : '',
    quantity: li.quantity != null ? String(li.quantity) : '',
    unit_price: li.unit_price != null ? String(li.unit_price) : '',
  }))
}

/**
 * Edit modal for a PO record. Edits correctable top-level fields + payload
 * line items, plus an optional note. Sends ONE multipart PATCH carrying the
 * edit JSON (as a `payload` form field) plus the optional replacement PDF, so
 * the server applies everything atomically as a single audited change.
 */
export function PoEditModal({
  po,
  userId,
  open,
  onClose,
  onSaved,
}: {
  po: ProcessedPo
  userId: string | null
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [party, setParty] = useState(po.party ?? '')
  const [poNumber, setPoNumber] = useState(po.po_number ?? '')
  const [status, setStatus] = useState<PoStatus>(po.status)
  const [soNumbers, setSoNumbers] = useState(po.so_numbers ?? '')
  const [fmRecord, setFmRecord] = useState(po.filemaker_record_id ?? '')
  const [enteredVia, setEnteredVia] = useState<PoEnteredVia | ''>(po.entered_via ?? '')
  const [lines, setLines] = useState<EditableLine[]>(payloadLines(po))
  const [note, setNote] = useState('')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateLine(i: number, key: keyof EditableLine, value: string) {
    setLines((cur) => cur.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)))
  }
  function addLine() {
    setLines((cur) => [...cur, { item_number: '', description: '', quantity: '', unit_price: '' }])
  }
  function removeLine(i: number) {
    setLines((cur) => cur.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const body = {
        party: party.trim(),
        po_number: poNumber.trim(),
        status,
        so_numbers: soNumbers.trim(),
        filemaker_record_id: fmRecord.trim(),
        entered_via: enteredVia || null,
        line_items: lines.map((l) => ({
          item_number: l.item_number.trim() || null,
          description: l.description.trim() || null,
          quantity: toNum(l.quantity),
          unit_price: toNum(l.unit_price),
        })),
        note: note.trim() || null,
      }
      // ONE multipart PATCH: edit JSON as a `payload` field + optional new PDF,
      // so the server applies + audits everything atomically.
      const fd = new FormData()
      fd.append('payload', JSON.stringify(body))
      if (pdfFile) fd.append('file', pdfFile)
      const res = await fetch(`/api/po-automation/${po.id}`, {
        method: 'PATCH',
        headers: { 'x-user-id': userId || '' },
        body: fd,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }

      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('po.edit.error'))
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full rounded border bg-background px-2 py-1.5 text-sm'
  const labelClass = 'mb-1 block text-xs font-medium text-muted-foreground'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="text-base">
            {t('po.edit.title')} {po.po_number || ''}
          </DialogTitle>
          <DialogDescription className="sr-only">{t('po.edit.title')}</DialogDescription>
        </DialogHeader>

        <div data-lenis-prevent className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass}>{t('po.edit.party')}</label>
              <input className={inputClass} value={party} onChange={(e) => setParty(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>{t('po.edit.poNumber')}</label>
              <input className={inputClass} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>{t('po.edit.status')}</label>
              <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as PoStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`po.status.${s}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('po.edit.enteredVia')}</label>
              <select
                className={inputClass}
                value={enteredVia}
                onChange={(e) => setEnteredVia(e.target.value as PoEnteredVia | '')}
              >
                <option value="">—</option>
                {VIAS.map((v) => (
                  <option key={v} value={v}>
                    {t(`po.via.${v}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('po.edit.soNumbers')}</label>
              <input className={inputClass} value={soNumbers} onChange={(e) => setSoNumbers(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>{t('po.edit.fmRecord')}</label>
              <input className={inputClass} value={fmRecord} onChange={(e) => setFmRecord(e.target.value)} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('po.edit.lineItems')}
              </span>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs hover:bg-muted"
              >
                <Plus className="size-3" /> {t('po.edit.addLine')}
              </button>
            </div>
            <div className="space-y-2">
              {lines.length === 0 && <p className="text-xs text-muted-foreground">{t('po.edit.noLines')}</p>}
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
                  <input
                    className="col-span-3 rounded border bg-background px-1.5 py-1 text-xs"
                    placeholder={t('po.edit.itemNumber')}
                    value={l.item_number}
                    onChange={(e) => updateLine(i, 'item_number', e.target.value)}
                  />
                  <input
                    className="col-span-3 rounded border bg-background px-1.5 py-1 text-xs sm:col-span-5"
                    placeholder={t('po.edit.description')}
                    value={l.description}
                    onChange={(e) => updateLine(i, 'description', e.target.value)}
                  />
                  <input
                    className="col-span-2 rounded border bg-background px-1.5 py-1 text-xs sm:col-span-1"
                    placeholder={t('po.edit.qty')}
                    value={l.quantity}
                    inputMode="decimal"
                    onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                  />
                  <input
                    className="col-span-3 rounded border bg-background px-1.5 py-1 text-xs sm:col-span-2"
                    placeholder={t('po.edit.unitPrice')}
                    value={l.unit_price}
                    inputMode="decimal"
                    onChange={(e) => updateLine(i, 'unit_price', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    aria-label={t('po.edit.removeLine')}
                    className="col-span-1 flex items-center justify-center rounded text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Replace PDF */}
          <div>
            <label className={labelClass}>{t('po.edit.replacePdf')}</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
            />
            {pdfFile && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Upload className="size-3" /> {pdfFile.name}
              </p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className={labelClass}>{t('po.edit.note')}</label>
            <textarea
              className={inputClass}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('po.edit.notePlaceholder')}
            />
          </div>

          {error && (
            <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t('ui.cancel')}
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('ui.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
