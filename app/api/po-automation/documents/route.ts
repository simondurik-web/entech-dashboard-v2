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
  signedDocUrl,
  validatedExt,
  type OrderDocType,
} from '@/lib/po-automation/documents'
import { requireUserOrService } from '@/lib/require-user'
import { attachBolToSalesOrder, invalidateSignedBolsForOrder } from '@/lib/erpnext/external-bol'

export const dynamic = 'force-dynamic'

interface DocsCaller {
  userId: string
  isService: boolean
  /** PO-Automation access — REQUIRED for non-BOL doc types (erp_entry docs are
   *  PO-side data; a shipping-BOL-only caller must never read/write/delete them). */
  poAccess: boolean
}

async function gate(req: NextRequest): Promise<NextResponse | DocsCaller> {
  // requireUserOrService (not requireUser): the BOL / PO-PDF auto-upload scripts
  // (release_toter.py, attach_po_pdf.py) POST here server-side with no Supabase
  // user session, authenticating via the x-service-key shared secret instead.
  const authed = await requireUserOrService(req)
  if (!authed?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // A valid service key IS the authorization (skip the per-user role check).
  if (authed.isService) return { userId: authed.id, isService: true, poAccess: true }
  // A human caller passes if they can access PO Automation OR are allowed to
  // manage shipping BOLs (Admin/Manager/Shipping Manager) — the latter lets a
  // shipping manager without PO-Automation access still handle BOLs. NOTE: this
  // is intentionally a UNION, not the shipping-only role set: PO-Automation users
  // have always been able to manage BOLs on the PO surface, so requiring the
  // shipping role here would REGRESS that. No new capability is granted — each
  // group keeps exactly what it already had. Doc-TYPE scoping (BOL-only callers
  // never see/touch erp_entry docs) is enforced per-handler via `poAccess`.
  const poAccess = await canAccessPoAutomation(authed.id)
  if (!poAccess && !(await canManageShippingBol(authed.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return { userId: authed.id, isService: false, poAccess }
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
  const caller = gated

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

  // Refine by customer, EXACT (normalized) match only. Substring matching would
  // leak across customers whose names are prefixes of one another (e.g. a doc
  // filed under "One Monroe - Des Moines" being returned for a query on "One
  // Monroe" when they share a PO#). norm() lowercases + trims, so legitimate
  // casing variance of the SAME party (e.g. "SERVICE CASTER CORPORATION" vs
  // "Service Caster Corporation") still matches; different parties never do.
  const wantCustomer = norm(customer)
  let rows = (data ?? []).filter((d) => norm(d.customer) === wantCustomer)

  // Doc-type scoping: erp_entry docs are PO-side data — a shipping-BOL-only
  // caller gets BOLs only. Server-side, never left to the UI filters.
  if (!caller.poAccess) rows = rows.filter((d) => (d.doc_type ?? 'bol') === 'bol')

  // Private bucket: the browser can only fetch via short-lived signed URLs —
  // the stored public-form URL is just the path carrier.
  const documents = await Promise.all(
    rows.map(async (d) => ({ ...d, file_url: await signedDocUrl(d.file_url) }))
  )
  return NextResponse.json({ documents })
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
  const caller = gated
  const userId = caller.userId

  const form = await req.formData()
  const file = form.get('file')
  const customer = str(form.get('customer'))
  const po = str(form.get('po'))
  // Optional ERPNext Sales Order tag — scopes a BOL to ONE sales order of a
  // multi-SO PO (per-SO BOLs, Simon 2026-07-21). Absent = order-level (legacy).
  const soRaw = str(form.get('so'))
  const docNumber = str(form.get('doc_number'))
  const notes = str(form.get('notes'))
  const docTypeRaw = str(form.get('doc_type')) ?? 'bol'
  // Reject unknown types outright — silently coercing a mistyped 'ERP_ENTRY'
  // to 'bol' would misfile a PO-side proof where BOL-only callers can see it.
  if (!ORDER_DOC_TYPES.includes(docTypeRaw as OrderDocType)) {
    return NextResponse.json({ error: `Unsupported doc_type '${docTypeRaw}'` }, { status: 400 })
  }
  const docType = docTypeRaw as OrderDocType
  // Non-BOL doc types are PO-side data — BOL-only shipping callers can't file them.
  if (docType !== 'bol' && !caller.poAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file' }, { status: 400 })
  }
  if (!po) {
    return NextResponse.json({ error: 'PO number is required' }, { status: 400 })
  }
  // Same shape as ERPNext doc names elsewhere (DN_NAME in the fulfillment
  // routes). Only meaningful on BOLs; reject garbage rather than storing it.
  const so = soRaw && docType === 'bol' ? soRaw.trim() : null
  if (so && !/^[A-Za-z0-9-]{1,40}$/.test(so)) {
    return NextResponse.json({ error: 'Invalid sales order' }, { status: 400 })
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
      so_number: so,
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
      changes: [{ field: `${docType}_added`, old: null, new: docNumber || fileName }],
      note: null,
    })
  if (auditErr) console.error('[po-automation] document add audit error:', auditErr)

  // Carrier BOLs also land on the ERPNext Sales Order (scan-enforcement plan,
  // Simon 2026-06-26/2026-07-17) — best-effort, never fails the upload.
  let erpSo: string | null = null
  if (docType === 'bol') {
    try {
      erpSo = await attachBolToSalesOrder({
        customer,
        poNumber: po,
        soName: so,
        bytes: new Uint8Array(buf),
        fileName,
        contentType: file.type,
      })
    } catch (e) {
      console.error('[po-automation] BOL ERPNext attach failed:', e)
    }
  }

  return NextResponse.json({ document: { ...row, file_url: await signedDocUrl(row.file_url) }, erpSo })
}

/** DELETE /api/po-automation/documents?id= — removes a document row + its object. */
export async function DELETE(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const caller = gated
  const userId = caller.userId

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: doc, error: lookupErr } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('file_url, po_number, doc_type, doc_number, file_name, customer')
    .eq('id', id)
    .single()

  // The lookup must SUCCEED before we authorize — deleting past a failed
  // lookup would skip the doc-type check (fail-open under a transient DB
  // error). PGRST116 = zero rows (a plain 404); anything else is a real
  // DB failure and must not read as "already gone".
  if (lookupErr && lookupErr.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Doc-type scoping mirrors GET/POST: a BOL-only caller must not delete
  // erp_entry docs (their ids are hidden from that caller's GET, but ids must
  // not be a capability — authorize the mutation itself).
  if ((doc.doc_type ?? 'bol') !== 'bol' && !caller.poAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Deleting a BOL first clears its DNs' signature-stamped copies — otherwise
  // an OLDER surviving BOL row could make a stamp of the deleted file look
  // valid again (created_at ordering). Aborts on failure, before any mutation.
  if ((doc.doc_type ?? 'bol') === 'bol' && doc.po_number) {
    try {
      await invalidateSignedBolsForOrder(doc.customer ?? null, doc.po_number)
    } catch (e) {
      console.error('[po-automation] signed-BOL invalidation failed:', e)
      return NextResponse.json(
        { error: 'Could not clear the previously signed copy. Try again.' },
        { status: 502 }
      )
    }
  }

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
        changes: [
          {
            // Normalize against the allowlist — never interpolate a raw DB value.
            field: `${ORDER_DOC_TYPES.includes(doc.doc_type as OrderDocType) ? doc.doc_type : 'bol'}_removed`,
            old: doc.doc_number || doc.file_name || null,
            new: null,
          },
        ],
        note: null,
      })
    if (auditErr) console.error('[po-automation] document delete audit error:', auditErr)
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
  const userId = gated.userId

  const form = await req.formData()
  const id = str(form.get('id'))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: existing } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('file_url, po_number, so_number, doc_type, doc_number, file_name, customer')
    .eq('id', id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // PATCH edits BOLs only. Non-BOL docs (erp_entry proofs) are immutable through
  // this endpoint for EVERY caller — the guard runs before any edit logic, so a
  // BOL-only caller can never modify a PO-side document by id.
  if ((existing.doc_type ?? 'bol') !== 'bol') {
    return NextResponse.json({ error: 'Unsupported document type' }, { status: 400 })
  }

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

  // A REPLACED file must first clear any signature-stamped copies — they were
  // made from the OLD file and the row keeps its created_at, so nothing else
  // can catch the swap. Runs BEFORE the row update and aborts on failure:
  // clearing without swapping is harmless (crew re-stamps), swapping without
  // clearing prints a signature on the wrong document.
  if (newPath && (existing.doc_type ?? 'bol') === 'bol' && existing.po_number) {
    try {
      await invalidateSignedBolsForOrder(existing.customer ?? null, existing.po_number)
    } catch (e) {
      console.error('[po-automation] signed-BOL invalidation failed:', e)
      await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([newPath])
      return NextResponse.json(
        { error: 'Could not clear the previously signed copy. Try again.' },
        { status: 502 }
      )
    }
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

  // Re-attach the replaced file to the ERPNext SO (best-effort — the signed
  // copies were already cleared before the swap above).
  if (newPath && (existing.doc_type ?? 'bol') === 'bol' && existing.po_number && file instanceof File) {
    try {
      await attachBolToSalesOrder({
        customer: existing.customer ?? null,
        poNumber: existing.po_number,
        soName: existing.so_number ?? null,
        bytes: new Uint8Array(await file.arrayBuffer()),
        fileName: (update.file_name as string) ?? file.name,
        contentType: file.type,
      })
    } catch (e) {
      console.error('[po-automation] replaced-BOL ERPNext attach failed:', e)
    }
  }

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

  return NextResponse.json({ document: { ...row, file_url: await signedDocUrl(row.file_url) } })
}
