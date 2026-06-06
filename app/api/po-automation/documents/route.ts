import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccessPoAutomation } from '@/lib/po-automation/guard'
import { resolvePoActor, str } from '@/lib/po-automation/edit'
import {
  PO_DOC_BUCKET,
  MAX_DOC_BYTES,
  ORDER_DOC_TYPES,
  docPublicUrl,
  pathSlug,
  isAllowedDocType,
  type OrderDocType,
} from '@/lib/po-automation/documents'

export const dynamic = 'force-dynamic'

async function gate(req: NextRequest): Promise<NextResponse | string> {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPoAutomation(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return userId
}

function norm(v: string | null): string {
  return (v ?? '').trim().toLowerCase()
}

/**
 * GET /api/po-automation/documents?customer=&po=  — list order documents (BOLs)
 * for an order. Matches po_number exactly (case-insensitive) and refines the
 * customer match in JS, mirroring the processed_pos lookup.
 */
export async function GET(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated

  const sp = new URL(req.url).searchParams
  const customer = sp.get('customer')
  const po = sp.get('po')
  if (!po?.trim()) return NextResponse.json({ documents: [] })

  const { data, error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('*')
    .ilike('po_number', po.trim())
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[po-automation] documents fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 502 })
  }

  // Refine by customer when provided (party casing varies upstream); if no
  // customer is given, return all docs for the PO number.
  const wantCustomer = norm(customer)
  const rows = (data ?? []).filter((d) => {
    if (!wantCustomer) return true
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
    return NextResponse.json({ error: 'Only PDF or image files are allowed' }, { status: 400 })
  }
  if (file.size > MAX_DOC_BYTES) {
    return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 400 })
  }

  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'
  const poSlug = pathSlug(po, 'unknown-po')
  const path = `${poSlug}/${docType}/${crypto.randomUUID()}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const up = await supabaseAdmin.storage
    .from(PO_DOC_BUCKET)
    .upload(path, buf, { contentType: file.type || 'application/octet-stream', upsert: true })
  if (up.error) {
    return NextResponse.json({ error: up.error.message }, { status: 500 })
  }
  const fileUrl = docPublicUrl(path)

  const actor = await resolvePoActor(userId)
  const { data: row, error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .insert({
      customer,
      po_number: po,
      doc_type: docType,
      doc_number: docNumber,
      file_url: fileUrl,
      file_name: file.name.slice(0, 200),
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

  return NextResponse.json({ document: row })
}

/** DELETE /api/po-automation/documents?id= — removes a document row + its object. */
export async function DELETE(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: doc } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .select('file_url')
    .eq('id', id)
    .single()

  // Best-effort storage cleanup — derive the object path from the public URL.
  if (doc?.file_url) {
    const marker = `/object/public/${PO_DOC_BUCKET}/`
    const idx = doc.file_url.indexOf(marker)
    if (idx >= 0) {
      const objPath = decodeURIComponent(doc.file_url.slice(idx + marker.length))
      await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove([objPath])
    }
  }

  const { error } = await supabaseAdmin
    .schema('po_automation')
    .from('order_documents')
    .delete()
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
