import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPoAutomation, canManageShippingBol } from '@/lib/po-automation/guard'
import { resolvePoActor, str, escapeLike } from '@/lib/po-automation/edit'
import {
  PO_DOC_BUCKET,
  MAX_DOC_BYTES,
  ORDER_DOC_TYPES,
  docPublicUrl,
  pathSlug,
  isAllowedDocType,
  validatedExt,
  type OrderDocType,
} from '@/lib/po-automation/documents'
import { requireUserOrService } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

async function gate(req: NextRequest): Promise<NextResponse | string> {
  // requireUserOrService (not requireUser): the BOL / PO-PDF auto-upload scripts
  // (release_toter.py, attach_po_pdf.py) POST here server-side with no Supabase
  // user session, authenticating via the x-service-key shared secret instead.
  const authed = await requireUserOrService(req)
  if (!authed?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // A valid service key IS the authorization (skip the per-user role check); a
  // human caller passes if they can access PO Automation OR are allowed to
  // manage shipping BOLs (Admin/Manager/Shipping Manager) — the latter lets a
  // shipping manager without PO-Automation access still handle BOLs.
  if (!authed.isService && !(await canAccessPoAutomation(authed.id)) && !(await canManageShippingBol(authed.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return authed.id
}

function norm(v: string | null): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * GET /api/po-automation/documents?customer=&po=  — list order documents (BOLs)
 * for an order. Requires BOTH customer AND po to avoid leaking every doc for a
 * PO number across customers. Matches po_number literally (case-insensitive,
 * ilike wildcards escaped) and refines the customer match in JS.
 */
export async function GET(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated

  const sp = new URL(req.url).searchParams
  const customer = sp.get('customer')
  const po = sp.get('po')
  // Require both — never return all docs for a PO number across customers.
  if (!po?.trim() || !customer?.trim()) return NextResponse.json({ documents: [] })

  const { data, error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('*')
    .ilike('po_number', escapeLike(po.trim()))
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[po-automation] documents fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 502 })
  }

  // Refine by customer (party casing varies upstream).
  const wantCustomer = norm(customer)
  const rows = (data ?? []).filter((d) => {
    const c = norm(d.customer)
    return c === wantCustomer || c.includes(wantCustomer) || wantCustomer.includes(c)
  })

  return NextResponse.json({ documents: rows })
}

/**
 * POST /api/po-automation/documents — multipart upload of an order document.
 * Fields: file (required), customer, po (required), doc_type (default 'bol'),
 * doc_number, notes. Uploads to the po-documents bucket under
 * <po-slug>/bol/<uuid>.<ext> and inserts an order_documents row (source='manual').
 *
 * NOTE: an email-scanning automation would insert here with source='email'
 * (same row shape) once that pipeline lands — no schema change needed.
 */
export async function POST(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const userId = gated

  const form = await req.formData()
  const file = form.get('file')
  const customer = str(form.get('customer'))
  const po = str(form.get('po'))
  const docNumber = str(form.get('doc_number'))
  const notes = str(form.get('notes'))
  const docTypeRaw = str(form.get('doc_type')) ?? 'bol'
  const docType: OrderDocType = ORDER_DOC_TYPES.includes(docTypeRaw as OrderDocType)
    ? (docTypeRaw as OrderDocType)
    : 'bol'

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }
  if (!po) {
    return NextResponse.json({ error: 'PO number is required' }, { status: 400 })
  }
  if (!isAllowedDocType(file.type)) {
    return NextResponse.json({ error: 'Only PDF, PNG, JPEG or WebP files are allowed' }, { status: 400 })
  }
  // Extension must be in the allowlist AND match the declared MIME type.
  const ext = validatedExt(file.type, file.name)
  if (!ext) {
    return NextResponse.json({ error: 'File extension does not match its type' }, { status: 400 })
  }
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })
  }

  const poSlug = pathSlug(po, 'unknown-po')
  const path = `${poSlug}/${docType}/${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const up = await supabaseAdmin.storage
    .from(PO_DOC_BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true })
  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 500 })
  }
  const fileUrl = docPublicUrl(path)

  const actor = await resolvePoActor(userId)
  const fileName = file.name.slice(0, 200)
  const { data: row, error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .insert({
      customer,
      po_number: po,
      doc_type: docType,
      doc_number: docNumber,
      file_url: fileUrl,
      file_name: fileName,
      uploaded_by: userId,
      uploaded_by_name: actor.name,
      source: 'manual',
      notes,
    })
    .select('*')
    .single()
  if (error) {
    // Don't leave an orphaned object in the bucket.
    await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([path])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Best-effort audit trail entry for document housekeeping (po_id is null —
  // documents aren't tied to a single processed_pos row).
  const { error: auditErr } = await supabaseAdmin
    .schema('po_automation')
    .from('po_audit_log')
    .insert({
      po_id: null,
      po_number: po,
      changed_by: userId,
      changed_by_name: actor.name,
      changes: [{ field: 'bol_added', old: null, new: docNumber || fileName }],
      note: null,
    })
  if (auditErr) console.error('[po-automation] BOL add audit error:', auditErr)

  return NextResponse.json({ document: row })
}

/** DELETE /api/po-automation/documents?id= — removes a document row + its object. */
export async function DELETE(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const userId = gated

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: doc } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('file_url, po_number, doc_number, file_name')
    .eq('id', id)
    .single()

  // Delete the DB row FIRST — a storage-removal failure then leaves an orphan
  // object but never a DB row pointing at a missing file.
  const { error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort storage cleanup — derive the object path from the public URL.
  if (doc?.file_url) {
    const marker = `/object/public/${PO_DOC_BUCKET}/`
    const idx = doc.file_url.indexOf(marker)
    if (idx >= 0) {
      const objPath = decodeURIComponent(doc.file_url.slice(idx + marker.length))
      await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([objPath])
    }
  }

  // Best-effort audit trail entry for document housekeeping.
  if (doc) {
    const actor = await resolvePoActor(userId)
    const { error: auditErr } = await supabaseAdmin
      .schema('po_automation')
      .from('po_audit_log')
      .insert({
        po_id: null,
        po_number: doc.po_number ?? null,
        changed_by: userId,
        changed_by_name: actor.name,
        changes: [{ field: 'bol_removed', old: doc.doc_number || doc.file_name || null, new: null }],
        note: null,
      })
    if (auditErr) console.error('[po-automation] BOL delete audit error:', auditErr)
  }

  return NextResponse.json({ ok: true })
}

/**
 * PATCH /api/po-automation/documents — edit a BOL's number/notes and/or REPLACE
 * its file (multipart: id required; doc_number, notes, file all optional). Used
 * when the wrong file was uploaded or the customer sent an updated BOL — fixing
 * it in place keeps the same row (and its history) instead of delete-and-re-add.
 */
export async function PATCH(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const userId = gated

  const form = await req.formData()
  const id = str(form.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: existing } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('file_url, po_number, doc_type, doc_number, file_name')
    .eq('id', id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const update: Record<string, string | null> = {}
  const docNumber = str(form.get('doc_number'))
  const notes = str(form.get('notes'))
  if (form.has('doc_number')) update.doc_number = docNumber ?? null
  if (form.has('notes')) update.notes = notes ?? null

  // Optional file replacement — validate exactly like POST, upload the new object,
  // swap the URL, then best-effort remove the old object after the row is updated.
  const file = form.get('file')
  let newPath: string | null = null
  let oldPath: string | null = null
  if (file instanceof File && file.size > 0) {
    if (!isAllowedDocType(file.type)) {
      return NextResponse.json({ error: 'Only PDF, PNG, JPEG or WebP files are allowed' }, { status: 400 })
    }
    const ext = validatedExt(file.type, file.name)
    if (!ext) {
      return NextResponse.json({ error: 'File extension does not match its type' }, { status: 400 })
    }
    if (file.size > MAX_DOC_BYTES) {
      return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })
    }
    const docType = (existing.doc_type as OrderDocType) ?? 'bol'
    const poSlug = pathSlug(existing.po_number, 'unknown-po')
    newPath = `${poSlug}/${docType}/${crypto.randomUUID()}.${ext}`
    const buf = Buffer.from(await file.arrayBuffer())
    const up = await supabaseAdmin.storage
      .from(PO_DOC_BUCKET)
      .upload(newPath, buf, { contentType: file.type, upsert: true })
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    update.file_url = docPublicUrl(newPath)
    update.file_name = file.name.slice(0, 200)
    // Derive the old object path so we can clean it up after the swap.
    if (existing.file_url) {
      const marker = `/object/public/${PO_DOC_BUCKET}/`
      const idx = existing.file_url.indexOf(marker)
      if (idx >= 0) oldPath = decodeURIComponent(existing.file_url.slice(idx + marker.length))
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data: row, error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) {
    // If we already uploaded a replacement object, remove it so it isn't orphaned.
    if (newPath) await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([newPath])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Old object cleanup only after the row points at the new one (best-effort).
  if (oldPath) await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([oldPath])

  const actor = await resolvePoActor(userId)
  const field = newPath ? 'bol_replaced' : 'bol_edited'
  const { error: auditErr } = await supabaseAdmin
    .schema('po_automation')
    .from('po_audit_log')
    .insert({
      po_id: null,
      po_number: existing.po_number ?? null,
      changed_by: userId,
      changed_by_name: actor.name,
      changes: [{ field, old: existing.doc_number || existing.file_name || null, new: update.doc_number ?? docNumber ?? existing.doc_number ?? null }],
      note: null,
    })
  if (auditErr) console.error('[po-automation] BOL edit audit error:', auditErr)

  return NextResponse.json({ document: row })
}
