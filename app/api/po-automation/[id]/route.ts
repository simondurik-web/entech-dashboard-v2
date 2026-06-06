import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPoAutomation } from '@/lib/po-automation/guard'
import {
  EDITABLE_PO_FIELDS,
  normalizeLineItem,
  mergeLineItem,
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
 * Single multipart/form-data request carries BOTH the field/line edits and an
 * optional replacement PDF, so one edit = exactly one atomic apply + one audit
 * entry:
 *  - `payload`  — JSON string with the edit body:
 *      { party?, po_number?, status?, so_numbers?, filemaker_record_id?,
 *        entered_via?, line_items?: PoLineItem[], note?: string }
 *  - `file`     — optional new PO PDF (replaces po_pdf_url).
 *
 * For backward compatibility a bare application/json body is still accepted
 * (no file). The route computes a diff vs the current row, (if a file is given)
 * uploads it, then applies the column updates + writes the audit row in ONE
 * atomic RPC (po_automation.apply_po_edit). If anything fails AFTER the PDF is
 * uploaded, the orphaned storage object is removed before returning.
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
  let body: Record<string, unknown> = {}
  let file: File | null = null

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const raw = form.get('file')
    file = raw instanceof File ? raw : null
    const payloadStr = str(form.get('payload'))
    if (payloadStr) {
      try {
        body = JSON.parse(payloadStr) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: 'Invalid payload JSON' }, { status: 400 })
      }
    }
  } else {
    // Backward-compatible bare JSON body (field edits only, no PDF replace).
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  }

  note = str(body.note)

  // ── Field edits ────────────────────────────────────────────────────────────
  for (const field of EDITABLE_PO_FIELDS) {
    if (!(field in body)) continue
    const next = str(body[field])
    const prev = str((row as Record<string, unknown>)[field])
    if (next !== prev) {
      update[field] = next
      changes.push({ field, old: prev, new: next })
    }
  }

  // ── payload.line_items — diff item-by-item, MERGING edits into existing
  //    objects so unmodeled keys (UOM, totals, extraction metadata) survive. ──
  if (Array.isArray(body.line_items)) {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    const storedRaw: unknown[] = Array.isArray(payload.line_items)
      ? (payload.line_items as unknown[])
      : []
    const oldItems: PoLineItem[] = storedRaw.map(normalizeLineItem)
    const incomingRaw = body.line_items as unknown[]
    const newItems: PoLineItem[] = incomingRaw.map(normalizeLineItem)
    // Merged objects to persist (preserve other keys from the matching stored item).
    const mergedItems: PoLineItem[] = incomingRaw.map((raw, i) => mergeLineItem(storedRaw[i], raw))

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
      // Preserve all other payload keys; only swap line_items (merged).
      update.payload = { ...payload, line_items: mergedItems }
    }
  }

  // ── Optional PDF replace — upload BEFORE applying so po_pdf_url joins the
  //    same atomic update. Track the path to clean up on later failure. ───────
  let uploadedPath: string | null = null
  if (file) {
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
    uploadedPath = path
    const newUrl = docPublicUrl(path)
    update.po_pdf_url = newUrl
    changes.push({ field: 'po_pdf_url', old: row.po_pdf_url ?? null, new: newUrl })
  }

  // Nothing to do: no field changes AND no note. (A standalone note with zero
  // field changes still writes an audit row below.)
  if (changes.length === 0 && !note) {
    // Remove any orphaned PDF we may have uploaded (defensive; unreachable since
    // a file produces a change, but keep the bucket clean regardless).
    if (uploadedPath) await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([uploadedPath])
    return NextResponse.json({ ok: true, changes: 0, message: 'No changes detected' })
  }

  if (changes.length > 0) update.updated_at = new Date().toISOString()

  const actor = await resolvePoActor(userId)
  const auditPayload = {
    po_number: row.po_number,
    changed_by: userId,
    changed_by_name: actor.name,
    changes,
    note,
  }

  // ── Atomic apply: UPDATE processed_pos + INSERT po_audit_log in one txn. ────
  const { data: updatedRow, error: rpcErr } = await supabaseAdmin
    .schema('po_automation')
    .rpc('apply_po_edit', { p_id: id, p_updates: update, p_audit: auditPayload })
  if (rpcErr) {
    console.error('[po-automation] apply_po_edit error:', rpcErr)
    // The edit was NOT applied — remove the orphaned PDF if we uploaded one.
    if (uploadedPath) await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([uploadedPath])
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, changes: changes.length, record: updatedRow })
}
