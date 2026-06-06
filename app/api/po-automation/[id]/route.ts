import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPoAutomation } from '@/lib/po-automation/guard'
import {
  EDITABLE_PO_FIELDS,
  normalizeLineItem,
  lineItemLabel,
  resolvePoActor,
  str,
  type PoChange,
  type PoLineItem,
} from '@/lib/po-automation/edit'
import { PO_DOC_BUCKET, MAX_DOC_BYTES, docPublicUrl, pathSlug } from '@/lib/po-automation/documents'
import type { ProcessedPo } from '@/lib/po-automation/types'

export const dynamic = 'force-dynamic'

async function gate(req: NextRequest): Promise<NextResponse | string> {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPoAutomation(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return userId
}

/** GET /api/po-automation/[id] — returns the audit history for this PO, newest first. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const { id } = await params

  const { data, error } = await supabaseAdmin
    .schema('po_automation')
    .from('po_audit_log')
    .select('*')
    .eq('po_id', id)
    .order('changed_at', { ascending: false })

  if (error) {
    console.error('[po-automation] audit fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 502 })
  }
  return NextResponse.json({ entries: data ?? [] })
}

/**
 * PATCH /api/po-automation/[id] — manually correct a PO record.
 *
 * Two modes (content-type dispatch):
 *  - multipart/form-data with a `file` field -> replaces the PO PDF (uploads to
 *    the po-documents bucket, updates po_pdf_url). A `note` field is optional.
 *  - application/json -> edits the correctable top-level fields +
 *    payload.line_items. Body shape:
 *      { party?, po_number?, status?, so_numbers?, filemaker_record_id?,
 *        entered_via?, line_items?: PoLineItem[], note?: string }
 *
 * Both compute a diff vs the current row and write ONE po_audit_log entry.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const userId = gated
  const { id } = await params

  // Load current row.
  const { data: current, error: loadErr } = await supabaseAdmin
    .schema('po_automation')
    .from('processed_pos')
    .select('*')
    .eq('id', id)
    .single()
  if (loadErr || !current) {
    return NextResponse.json({ error: 'PO not found' }, { status: 404 })
  }
  const row = current as ProcessedPo

  const contentType = req.headers.get('content-type') ?? ''
  const changes: PoChange[] = []
  const update: Record<string, unknown> = {}
  let note: string | null = null

  if (contentType.includes('multipart/form-data')) {
    // ── PDF replace ──────────────────────────────────────────────────────────
    const form = await req.formData()
    const file = form.get('file')
    note = str(form.get('note'))
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file' }, { status: 400 })
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'PO replacement must be a PDF' }, { status: 400 })
    }
    if (file.size > MAX_DOC_BYTES) {
      return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })
    }
    const poSlug = pathSlug(row.po_number, id)
    const path = `${poSlug}/po/${crypto.randomUUID()}.pdf`
    const buf = Buffer.from(await file.arrayBuffer())
    const up = await supabaseAdmin.storage
      .from(PO_DOC_BUCKET)
      .upload(path, buf, { contentType: 'application/pdf', upsert: true })
    if (up.error) {
      return NextResponse.json({ error: up.error.message }, { status: 500 })
    }
    const newUrl = docPublicUrl(path)
    update.po_pdf_url = newUrl
    changes.push({ field: 'po_pdf_url', old: row.po_pdf_url ?? null, new: newUrl })
  } else {
    // ── JSON field edits ─────────────────────────────────────────────────────
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    note = str(body.note)

    for (const field of EDITABLE_PO_FIELDS) {
      if (!(field in body)) continue
      const next = str(body[field])
      const prev = str((row as Record<string, unknown>)[field])
      if (next !== prev) {
        update[field] = next
        changes.push({ field, old: prev, new: next })
      }
    }

    // payload.line_items — diff item-by-item, normalizing numerics.
    if (Array.isArray(body.line_items)) {
      const payload = (row.payload ?? {}) as Record<string, unknown>
      const oldItems: PoLineItem[] = Array.isArray(payload.line_items)
        ? (payload.line_items as unknown[]).map(normalizeLineItem)
        : []
      const newItems: PoLineItem[] = (body.line_items as unknown[]).map(normalizeLineItem)

      const maxLen = Math.max(oldItems.length, newItems.length)
      const lineChanges: PoChange[] = []
      for (let i = 0; i < maxLen; i++) {
        const o = oldItems[i]
        const n = newItems[i]
        if (!o && n) {
          lineChanges.push({ field: `line_items[${i}]`, old: null, new: lineItemLabel(n) })
        } else if (o && !n) {
          lineChanges.push({ field: `line_items[${i}]`, old: lineItemLabel(o), new: null })
        } else if (o && n && lineItemLabel(o) !== lineItemLabel(n)) {
          lineChanges.push({ field: `line_items[${i}]`, old: lineItemLabel(o), new: lineItemLabel(n) })
        }
      }
      if (lineChanges.length > 0) {
        changes.push(...lineChanges)
        // Preserve all other payload keys; only swap line_items.
        update.payload = { ...payload, line_items: newItems }
      }
    }
  }

  if (changes.length === 0) {
    return NextResponse.json({ ok: true, changes: 0, message: 'No changes detected' })
  }

  update.updated_at = new Date().toISOString()
  const { data: updated, error: updErr } = await supabaseAdmin
    .schema('po_automation')
    .from('processed_pos')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (updErr) {
    console.error('[po-automation] update error:', updErr)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  const actor = await resolvePoActor(userId)
  const { error: auditErr } = await supabaseAdmin
    .schema('po_automation')
    .from('po_audit_log')
    .insert({
      po_id: id,
      po_number: row.po_number,
      changed_by: userId,
      changed_by_name: actor.name,
      changes,
      note,
    })
  if (auditErr) {
    // The record was already updated; log but don't fail the user-facing edit.
    console.error('[po-automation] audit insert error:', auditErr)
  }

  return NextResponse.json({ ok: true, changes: changes.length, record: updated })
}
