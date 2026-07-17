// Server-only helpers for the CARRIER / customer-provided ("external") BOL.
//
// Outside-trucking loads ship on the carrier's own BOL, uploaded ahead of time
// from the Ready to Ship / Shipping Overview card (Supabase `order_documents`,
// doc_type='bol') or — as a fallback — attached directly to the Delivery Note
// from the ship screen (ERPNext File `CustomerBOL-*`). At ship time the floor
// prints it alongside our packing slip + internal BOL, and the shipping crew
// can stamp the driver's captured signature onto it (the signed copy is stored
// in the `po-documents` bucket and attached to the DN as a permanent record).
//
// Everything here resolves a Delivery Note -> the bytes of its external BOL,
// normalized to a PDF so the print relay and pdf-lib can always handle it.

import { PDFDocument } from 'pdf-lib'
import { erpnextGet, erpnextGetDoc, erpnextFetchRaw, erpnextUpdate, erpnextUploadFile } from '@/lib/erpnext/client'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PO_DOC_BUCKET } from '@/lib/po-automation/documents'
import { escapeLike } from '@/lib/po-automation/edit'

/** Signed copies live at a deterministic path so a re-placement overwrites. */
export function signedBolPath(dn: string): string {
  return `signed-bol/${dn}.pdf`
}

const LETTER = { w: 612, h: 792 } // 8.5x11in in PDF points

export class ExternalBolUnsupportedError extends Error {}

export interface DnShipmentRef {
  dn: string
  so: string
  customer: string | null
  poNo: string | null
}

interface DnLite {
  docstatus: number
  customer?: string | null
  custom_ship_against_so?: string | null
  items?: { against_sales_order?: string | null }[]
}

/** Validate the DN is a real submitted shipment and resolve its SO + the
 *  customer/PO keys the dashboard's BOL uploads are stored under. */
export async function resolveDnShipment(dn: string): Promise<DnShipmentRef | null> {
  const doc = await erpnextGetDoc<DnLite>('Delivery Note', dn)
  const so =
    doc.custom_ship_against_so ||
    (doc.items ?? []).map((i) => i.against_sales_order).find(Boolean) ||
    null
  if (doc.docstatus !== 1 || !so) return null
  let poNo: string | null = null
  let customer: string | null = doc.customer ?? null
  try {
    const soDoc = await erpnextGetDoc<{ po_no?: string | null; customer?: string | null }>('Sales Order', so)
    poNo = soDoc.po_no ?? null
    customer = soDoc.customer ?? customer
  } catch {
    // SO fetch is best-effort — the DN attachment fallback still works
  }
  return { dn, so, customer, poNo }
}

export interface ExternalBolFile {
  bytes: Uint8Array
  contentType: string
  fileName: string | null
  source: 'dashboard' | 'erpnext'
}

/** The signed (signature-stamped) copy, if one has been produced. */
export async function fetchSignedExternalBol(dn: string): Promise<Uint8Array | null> {
  const { data } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).download(signedBolPath(dn))
  if (!data) return null
  return new Uint8Array(await data.arrayBuffer())
}

function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Download an order_documents file via its stored public URL, preferring the
 *  storage API (works even if the bucket later goes private). */
async function downloadDocUrl(fileUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const marker = `/object/public/${PO_DOC_BUCKET}/`
  const at = fileUrl.indexOf(marker)
  if (at >= 0) {
    const path = decodeURIComponent(fileUrl.slice(at + marker.length))
    const { data } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).download(path)
    if (data) {
      return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || 'application/octet-stream' }
    }
  }
  const res = await fetch(fileUrl, { cache: 'no-store', signal: AbortSignal.timeout(15000) }).catch(() => null)
  if (!res?.ok) return null
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  }
}

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

/** The ORIGINAL (un-stamped) external BOL: the dashboard upload for this
 *  order first, else the DN's own CustomerBOL-* attachment. */
export async function fetchOriginalExternalBol(ref: DnShipmentRef): Promise<ExternalBolFile | null> {
  // 1) Dashboard upload — order_documents keyed by customer + customer PO
  if (ref.customer && ref.poNo) {
    const { data } = await supabaseAdmin
      .schema('po_automation')
      .from('order_documents')
      .select('file_url, file_name, customer, created_at')
      .eq('doc_type', 'bol')
      .ilike('po_number', escapeLike(ref.poNo.trim()))
      .order('created_at', { ascending: false })
      .limit(25)
    const want = normName(ref.customer)
    const row = (data ?? []).find((d) => normName(d.customer) === want && d.file_url)
    if (row?.file_url) {
      const file = await downloadDocUrl(row.file_url)
      if (file) return { ...file, fileName: row.file_name ?? null, source: 'dashboard' }
    }
  }

  // 2) Fallback — CustomerBOL-* attached straight to the Delivery Note
  const fq = [
    listParam('filters', [
      ['attached_to_doctype', '=', 'Delivery Note'],
      ['attached_to_name', '=', ref.dn],
      ['file_name', 'like', 'CustomerBOL-%'],
    ]),
    listParam('fields', ['file_name', 'file_url']),
    'order_by=creation desc',
    'limit_page_length=1',
  ].join('&')
  const files =
    (await erpnextGet<{ data: { file_name: string; file_url: string }[] }>(`/api/resource/File?${fq}`).catch(() => ({
      data: [],
    }))).data ?? []
  const f = files[0]
  if (f?.file_url) {
    const res = await erpnextFetchRaw(f.file_url).catch(() => null)
    if (res?.ok) {
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') || 'application/octet-stream',
        fileName: f.file_name,
        source: 'erpnext',
      }
    }
  }
  return null
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

function sniffImage(bytes: Uint8Array, contentType: string): 'png' | 'jpg' | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return null
}

/** Normalize an external BOL (PDF or photo) to PDF bytes. Photos become a
 *  Letter page with the image fit inside — printable on the letter relay. */
export async function externalBolToPdf(bytes: Uint8Array, contentType: string): Promise<Uint8Array> {
  if (isPdf(bytes)) return bytes
  const kind = sniffImage(bytes, contentType)
  if (!kind) {
    // WEBP/HEIC etc. — pdf-lib can't embed these; ask for a re-upload
    throw new ExternalBolUnsupportedError('unsupported image format')
  }
  const pdf = await PDFDocument.create()
  const img = kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  const margin = 18
  const maxW = LETTER.w - margin * 2
  const maxH = LETTER.h - margin * 2
  const scale = Math.min(maxW / img.width, maxH / img.height, 1)
  const w = img.width * scale
  const h = img.height * scale
  const page = pdf.addPage([LETTER.w, LETTER.h])
  page.drawImage(img, { x: (LETTER.w - w) / 2, y: (LETTER.h - h) / 2, width: w, height: h })
  return pdf.save()
}

/** Best-effort push of a dashboard-uploaded carrier BOL into ERPNext: attach
 *  the file to the matching Sales Order (June-2026 prep fields) and mark the
 *  load Customer-Arranged. Returns the SO name, or null when no order matched.
 *  Callers treat failure as non-fatal — the dashboard copy is the print source. */
export async function attachBolToSalesOrder(input: {
  customer: string | null
  poNumber: string
  bytes: Uint8Array
  fileName: string
  contentType: string
}): Promise<string | null> {
  // dashboard_orders mirrors ERPNext — if_number's first token is the SO name
  const { data } = await supabaseAdmin
    .from('dashboard_orders')
    .select('if_number, customer, po_number')
    .ilike('po_number', escapeLike(input.poNumber.trim()))
    .limit(25)
  const want = normName(input.customer)
  const row = (data ?? []).find((r) => (!want || normName(r.customer) === want) && r.if_number)
  const soName = String(row?.if_number ?? '').trim().split(/\s+/)[0]
  if (!soName) return null
  const ext = input.fileName.includes('.') ? input.fileName.slice(input.fileName.lastIndexOf('.')) : ''
  const safeExt = /^\.[A-Za-z0-9]{1,5}$/.test(ext) ? ext : ''
  const up = await erpnextUploadFile({
    fileName: `CustomerBOL-${soName}-${Date.now()}${safeExt}`,
    bytes: input.bytes,
    attachedToDoctype: 'Sales Order',
    attachedToName: soName,
    contentType: input.contentType,
  })
  try {
    await erpnextUpdate('Sales Order', soName, {
      custom_customer_bol: up.file_url,
      custom_carrier_type: 'Customer-Arranged',
    })
  } catch {
    // the fields may not be editable post-submit — the File attach above is the record
  }
  return soName
}

/** The external BOL as printable PDF bytes — the signature-stamped copy when
 *  one exists, else the original. Null when the order has no external BOL. */
export async function fetchExternalBolPdf(
  ref: DnShipmentRef,
  opts?: { preferSigned?: boolean }
): Promise<{ bytes: Uint8Array; signed: boolean; source: 'dashboard' | 'erpnext' | 'signed' } | null> {
  if (opts?.preferSigned !== false) {
    const signed = await fetchSignedExternalBol(ref.dn)
    if (signed) return { bytes: signed, signed: true, source: 'signed' }
  }
  const original = await fetchOriginalExternalBol(ref)
  if (!original) return null
  return { bytes: await externalBolToPdf(original.bytes, original.contentType), signed: false, source: original.source }
}
