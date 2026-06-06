import { supabaseAdmin } from '@/lib/supabase-admin'

/** Public bucket for order documents (BOLs today; more doc_types later). */
export const PO_DOC_BUCKET = 'po-documents'
export const MAX_DOC_BYTES = 25 * 1024 * 1024 // 25 MB

export type OrderDocType = 'bol'
export const ORDER_DOC_TYPES: OrderDocType[] = ['bol']

export interface OrderDocument {
  id: string
  customer: string | null
  po_number: string | null
  doc_type: string
  doc_number: string | null
  file_url: string | null
  file_name: string | null
  uploaded_by: string | null
  uploaded_by_name: string | null
  source: string
  notes: string | null
  created_at: string
}

export function docPublicUrl(path: string): string {
  return supabaseAdmin.storage.from(PO_DOC_BUCKET).getPublicUrl(path).data.publicUrl
}

/** Slugify a value for safe use inside a storage path segment. */
export function pathSlug(value: string | null | undefined, fallback: string): string {
  const s = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || fallback
}

/** True if the file's MIME type is one we can preview/render safely. */
export function isAllowedDocType(mime: string): boolean {
  return mime === 'application/pdf' || mime.startsWith('image/')
}
