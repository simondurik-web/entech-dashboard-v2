import { supabaseAdmin } from '@/lib/supabase-admin'

/** Public bucket for order documents (BOLs today; more doc_types later). */
export const PO_DOC_BUCKET = 'po-documents'
export const MAX_DOC_BYTES = 25 * 1024 * 1024 // 25 MB

export type OrderDocType = 'bol' | 'erp_entry' | 'customer_po'
export const ORDER_DOC_TYPES: OrderDocType[] = ['bol', 'erp_entry', 'customer_po']

export interface OrderDocument {
  id: string
  customer: string | null
  po_number: string | null
  /** ERPNext Sales Order this doc is scoped to; null = order-level (whole PO). */
  so_number: string | null
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
// NOTE: once the bucket goes private, the stored public-form URL is an
// IDENTIFIER (it encodes the object path), not a fetchable link — every read
// path converts it with signedDocUrl() below or downloads via the storage API.

/** Convert a stored po-documents URL into a short-lived signed URL the browser
 *  can actually fetch (private-bucket hardening, Simon 2026-07-17). Non-bucket
 *  URLs pass through unchanged; traversal-shaped paths return null. */
export async function signedDocUrl(fileUrl: string | null | undefined): Promise<string | null> {
  if (!fileUrl) return null
  const marker = `/object/public/${PO_DOC_BUCKET}/`
  const at = fileUrl.indexOf(marker)
  if (at < 0) return fileUrl
  const path = decodeURIComponent(fileUrl.slice(at + marker.length))
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return null
  const { data } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? fileUrl
}

/** Slugify a value for safe use inside a storage path segment. */
export function pathSlug(value: string | null | undefined, fallback: string): string {
  const s = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || fallback
}

/**
 * Explicit allowlist of accepted document MIME types. We intentionally do NOT
 * accept `image/svg+xml` (XSS via embedded script) or a generic `image/*`.
 * Each MIME maps to the file extensions that are valid for it.
 */
export const ALLOWED_DOC_MIME: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
}

/** True if the file's MIME type is in the explicit allowlist. */
export function isAllowedDocType(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_DOC_MIME, mime)
}

/** Lowercased extension (no dot) parsed from a filename, or '' if none. */
export function fileExt(fileName: string | null | undefined): string {
  const parts = (fileName ?? '').toLowerCase().split('.')
  return parts.length > 1 ? parts.pop()!.replace(/[^a-z0-9]/g, '') : ''
}

/**
 * Validate an upload against the allowlist: the MIME must be allowed AND the
 * file extension must both be in the allowlist and match the declared MIME.
 * Returns the normalized extension on success, or null on rejection.
 */
export function validatedExt(mime: string, fileName: string | null | undefined): string | null {
  const allowedExts = ALLOWED_DOC_MIME[mime]
  if (!allowedExts) return null
  const ext = fileExt(fileName)
  if (!ext || !allowedExts.includes(ext)) return null
  return ext
}
