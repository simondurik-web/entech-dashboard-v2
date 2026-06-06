import { supabaseAdmin } from '@/lib/supabase-admin'

/** A single line item in a processed_pos payload. */
export interface PoLineItem {
  item_number?: string | null
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  [key: string]: unknown
}

/** One field-level change recorded in the audit log. */
export interface PoChange {
  field: string
  old: unknown
  new: unknown
}

export interface PoAuditEntry {
  id: string
  po_id: string | null
  po_number: string | null
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string
  changes: PoChange[] | null
  note: string | null
}

/** Editable top-level fields on a processed_pos record (not payload). */
export const EDITABLE_PO_FIELDS = [
  'party',
  'po_number',
  'status',
  'so_numbers',
  'filemaker_record_id',
  'entered_via',
] as const
export type EditablePoField = (typeof EDITABLE_PO_FIELDS)[number]

/**
 * Coerce a value to a number when it looks numeric, else null. supabase-js
 * returns Postgres numerics as strings, so we normalize both the stored and the
 * incoming line-item values before diffing to avoid phantom "250.00" !== "250".
 */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Escape Postgres `ilike` wildcards so a lookup matches the value literally.
 * `%`, `_` and `\` are special in LIKE/ILIKE patterns; without escaping a
 * po_number like "PO_1" would match "PO-1", "POX1", etc.
 */
export function escapeLike(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1')
}

/** Normalize a string-ish field to a trimmed string or null. */
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Normalize a payload line item for storage + comparison. */
export function normalizeLineItem(raw: unknown): PoLineItem {
  const li = (raw ?? {}) as Record<string, unknown>
  return {
    item_number: str(li.item_number),
    description: str(li.description),
    quantity: num(li.quantity),
    unit_price: num(li.unit_price),
  }
}

/**
 * Merge the editable fields (item_number/description/quantity/unit_price) from
 * an incoming raw line item into an existing stored line-item object so any
 * other keys (UOM, totals, extraction metadata, …) are preserved. Used when
 * persisting edits — never replace stored items with reduced 4-field objects.
 */
export function mergeLineItem(existing: unknown, raw: unknown): PoLineItem {
  const base = (existing ?? {}) as Record<string, unknown>
  const incoming = normalizeLineItem(raw)
  return {
    ...base,
    item_number: incoming.item_number,
    description: incoming.description,
    quantity: incoming.quantity,
    unit_price: incoming.unit_price,
  }
}

/** Compact display string for one line item (used in audit diffs). */
export function lineItemLabel(li: PoLineItem): string {
  const qty = li.quantity ?? '—'
  const price = li.unit_price ?? '—'
  return `${li.item_number ?? '—'} | ${li.description ?? '—'} | qty ${qty} @ ${price}`
}

/** Resolve the acting user's name/email for audit attribution. */
export async function resolvePoActor(
  userId: string | null | undefined
): Promise<{ name: string | null }> {
  if (!userId) return { name: null }
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('full_name, email')
    .eq('id', userId)
    .single()
  return { name: data?.full_name ?? data?.email ?? null }
}
