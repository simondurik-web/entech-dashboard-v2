'use client'

import { useState, useRef } from 'react'
import { authHeaders } from '@/lib/session-token'
import { invalidateInventoryClientCaches } from '@/lib/inventory-cache'
import { useI18n } from '@/lib/i18n'

// Click-to-edit minimum, shared by every surface that shows the number
// (Inventory table, Need to Make table, InventoryPopover). Saves to ERPNext
// Item.safety_stock through /api/erpnext/inventory/minimum — which enforces
// the edit_minimums permission (manager / shipping_manager / admin) and writes
// the minimum_change_log audit row. Callers gate rendering with
// canAccess('edit_minimums') and pass onSaved to update their local state.

export async function saveMinimum(partNumber: string, minimum: number): Promise<void> {
  const res = await fetch('/api/erpnext/inventory/minimum', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ partNumber, minimum }),
  })
  if (!res.ok) throw new Error(`minimum save failed (${res.status})`)
  invalidateInventoryClientCaches()
}

export function EditableMinimum({ partNumber, value, onSaved, className }: {
  partNumber: string
  value: number
  onSaved: (partNumber: string, minimum: number) => void
  className?: string
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const cancelledRef = useRef(false)

  const start = (e: React.MouseEvent) => {
    e.stopPropagation()
    cancelledRef.current = false
    setDraft(String(value || ''))
    setEditing(true)
  }

  const commit = async () => {
    if (cancelledRef.current) { setEditing(false); return }
    const n = Math.round(Number(draft))
    if (draft.trim() === '' || !Number.isFinite(n) || n < 0 || n === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await saveMinimum(partNumber, n)
      onSaved(partNumber, n)
      setEditing(false)
    } catch {
      alert(t('inventory.minimumSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={start}
        title={t('inventory.editMinimum')}
        className={`group inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-primary/10 transition-colors cursor-text ${className ?? ''}`}
      >
        <span>{value.toLocaleString()}</span>
        <span className="opacity-0 group-hover:opacity-60 text-[10px]">✎</span>
      </button>
    )
  }
  return (
    <input
      autoFocus
      type="number"
      min={0}
      value={draft}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { cancelledRef.current = true; setEditing(false) }
      }}
      className="w-20 rounded border border-primary/50 bg-background px-1 py-0.5 text-xs disabled:opacity-50"
    />
  )
}

export default EditableMinimum
