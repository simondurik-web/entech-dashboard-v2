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

// Signed copies live under signed-bol/<DN>-<uuid>.pdf. The uuid keeps the
// object key unguessable (the bucket is still public until the Slice-2
// private-bucket hardening — review panel 2026-07-17, codex+grok BLOCKER);
// discovery goes through storage.list, and a re-placement deletes the old
// object first so exactly one signed copy exists per DN.
export const SIGNED_BOL_FOLDER = 'signed-bol'

export function newSignedBolPath(dn: string): string {
  return `${SIGNED_BOL_FOLDER}/${dn}-${crypto.randomUUID()}.pdf`
}

export interface SignedBolObject {
  path: string
  createdAt: string | null
}

/** Locate the (single) signed copy for a DN, newest first. Matching is STRICT
 *  (<DN>-<uuid>.pdf) — a bare startsWith would let DN "X-1" match objects of
 *  DN "X-1-2" and even delete them on re-sign (review panel round 2). */
export async function findSignedBolObjects(dn: string, opts?: { strict?: boolean }): Promise<SignedBolObject[]> {
  const { data, error } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).list(SIGNED_BOL_FOLDER, {
    search: `${dn}-`,
    limit: 20,
    sortBy: { column: 'created_at', order: 'desc' },
  })
  // strict callers (invalidation) must not mistake a lookup failure for
  // "nothing to remove"; read paths fail open to the unsigned original
  if (error && opts?.strict) throw new Error(`signed copy lookup failed for ${dn}: ${error.message}`)
  const exact = new RegExp(
    `^${dn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\.pdf$`
  )
  return (data ?? [])
    .filter((o) => exact.test(o.name))
    .map((o) => ({ path: `${SIGNED_BOL_FOLDER}/${o.name}`, createdAt: o.created_at ?? null }))
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
  createdAt: string | null
}

function normName(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Download an order_documents file via the storage API ONLY — no raw URL
 *  fetch (a poisoned file_url must not become an SSRF vector; review panel
 *  2026-07-17). Non-bucket URLs are refused. */
async function downloadDocUrl(fileUrl: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const marker = `/object/public/${PO_DOC_BUCKET}/`
  const at = fileUrl.indexOf(marker)
  if (at < 0) return null
  const path = decodeURIComponent(fileUrl.slice(at + marker.length))
  const { data } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).download(path)
  if (!data) return null
  return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || 'application/octet-stream' }
}

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

export interface ExternalBolSource {
  kind: 'dashboard' | 'erpnext'
  /** stable identity of the exact file version — used to detect a swap
   *  between reading the original and publishing a stamped copy */
  sourceKey: string
  fileName: string | null
  createdAt: string | null
}

/** Which file IS the external BOL for this DN, without downloading it.
 *  Preference order: the DN's OWN CustomerBOL-* attachment first (release-
 *  scoped — a multi-release order can carry a different carrier BOL per
 *  shipment), then the order-level dashboard upload (customer + customer PO).
 *  Timestamps: ERP `creation` is naive server-local time; the ERP host runs
 *  UTC, matching Supabase, so cross-source comparison is sound. */
export async function resolveOriginalSource(ref: DnShipmentRef): Promise<ExternalBolSource | null> {
  const fq = [
    listParam('filters', [
      ['attached_to_doctype', '=', 'Delivery Note'],
      ['attached_to_name', '=', ref.dn],
      ['file_name', 'like', 'CustomerBOL-%'],
    ]),
    listParam('fields', ['file_name', 'file_url', 'creation']),
    'order_by=creation desc',
    'limit_page_length=1',
  ].join('&')
  const files =
    (await erpnextGet<{ data: { file_name: string; file_url: string; creation?: string }[] }>(
      `/api/resource/File?${fq}`
    ).catch(() => ({ data: [] }))).data ?? []
  const f = files[0]
  if (f?.file_url) {
    return { kind: 'erpnext', sourceKey: f.file_url, fileName: f.file_name, createdAt: f.creation ?? null }
  }

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
      return { kind: 'dashboard', sourceKey: row.file_url, fileName: row.file_name ?? null, createdAt: row.created_at ?? null }
    }
  }
  return null
}

/** The ORIGINAL (un-stamped) external BOL bytes for a DN. */
export async function fetchOriginalExternalBol(
  ref: DnShipmentRef
): Promise<(ExternalBolFile & { sourceKey: string }) | null> {
  const src = await resolveOriginalSource(ref)
  if (!src) return null
  if (src.kind === 'erpnext') {
    const res = await erpnextFetchRaw(src.sourceKey).catch(() => null)
    if (!res?.ok) return null
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      fileName: src.fileName,
      source: 'erpnext',
      createdAt: src.createdAt,
      sourceKey: src.sourceKey,
    }
  }
  const file = await downloadDocUrl(src.sourceKey)
  if (!file) return null
  return { ...file, fileName: src.fileName, source: 'dashboard', createdAt: src.createdAt, sourceKey: src.sourceKey }
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
  // dashboard_orders mirrors ERPNext — if_number's first token is the SO name.
  // A non-empty customer match is REQUIRED, and the (customer, PO) pair must
  // resolve to exactly ONE Sales Order — attaching to "the first PO match"
  // could file a BOL on another customer's order (review panel 2026-07-17,
  // codex BLOCKER). Ambiguous or empty → skip the ERPNext push entirely.
  const want = normName(input.customer)
  if (!want) return null
  const { data } = await supabaseAdmin
    .from('dashboard_orders')
    .select('if_number, customer, po_number')
    .ilike('po_number', escapeLike(input.poNumber.trim()))
    .limit(200)
  const soNames = new Set(
    (data ?? [])
      .filter((r) => normName(r.customer) === want && r.if_number)
      .map((r) => String(r.if_number).trim().split(/\s+/)[0])
      .filter(Boolean)
  )
  if (soNames.size !== 1) return null
  const soName = [...soNames][0]
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

/** A replaced (or deleted) BOL file keeps/loses its order_documents row in
 *  ways the created_at staleness check can't see — so before the mutation,
 *  remove the stamped signed copies of every DN behind this order; the next
 *  print uses the surviving original until the crew re-stamps (review panel
 *  rounds 2-3, codex). Covers wrapper DNs (custom_ship_against_so) AND
 *  natively-scanned DNs (item-linked). THROWS on lookup/delete failure — the
 *  caller must abort its mutation rather than leave a stale signed copy
 *  printable. Over-invalidation is safe; silence is not. */
export async function invalidateSignedBolsForOrder(customer: string | null, poNumber: string | null): Promise<void> {
  const want = normName(customer)
  if (!want || !poNumber?.trim()) return
  const { data, error: qErr } = await supabaseAdmin
    .from('dashboard_orders')
    .select('if_number, customer')
    .ilike('po_number', escapeLike(poNumber.trim()))
    .limit(200)
  if (qErr) throw new Error(`order lookup failed: ${qErr.message}`)
  const sos = [
    ...new Set(
      (data ?? [])
        .filter((r) => normName(r.customer) === want && r.if_number)
        .map((r) => String(r.if_number).trim().split(/\s+/)[0])
        .filter(Boolean)
    ),
  ]
  if (sos.length === 0) return
  const [byField, byItems] = await Promise.all([
    erpnextGet<{ data: { name: string }[] }>(
      `/api/resource/Delivery%20Note?${listParam('filters', [
        ['docstatus', '=', 1],
        ['custom_ship_against_so', 'in', sos],
      ])}&${listParam('fields', ['name'])}&limit_page_length=0`
    ),
    erpnextGet<{ data: { parent: string }[] }>(
      `/api/resource/Delivery%20Note%20Item?parent=${encodeURIComponent('Delivery Note')}&${listParam('filters', [
        ['against_sales_order', 'in', sos],
        ['docstatus', '=', 1],
      ])}&${listParam('fields', ['parent'])}&limit_page_length=0`
    ),
  ])
  const dns = [
    ...new Set([...(byField.data ?? []).map((d) => d.name), ...(byItems.data ?? []).map((d) => d.parent)]),
  ]
  for (const dn of dns) {
    const objs = await findSignedBolObjects(dn, { strict: true })
    if (objs.length) {
      const { error } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).remove(objs.map((o) => o.path))
      if (error) throw new Error(`signed copy remove failed for ${dn}: ${error.message}`)
    }
  }
}

export interface ExternalBolState {
  original: ExternalBolSource | null
  /** path of a signed copy that is NOT stale (stamped after the current
   *  original was uploaded). A replaced/deleted original invalidates it. */
  signedPath: string | null
}

/** Resolve what exists for a DN — identity only, NO byte download (the
 *  presence check must stay cheap and can't mistake a download hiccup for
 *  absence). No original → nothing (an orphaned signed copy of a deleted
 *  BOL must not keep printing). */
export async function getExternalBolState(ref: DnShipmentRef): Promise<ExternalBolState> {
  const original = await resolveOriginalSource(ref)
  if (!original) return { original: null, signedPath: null }
  const signed = (await findSignedBolObjects(ref.dn))[0] ?? null
  if (!signed) return { original, signedPath: null }
  const sAt = Date.parse(signed.createdAt ?? '')
  const oAt = Date.parse(original.createdAt ?? '')
  const stale = Number.isFinite(sAt) && Number.isFinite(oAt) && sAt < oAt
  return { original, signedPath: stale ? null : signed.path }
}

/** The external BOL as printable PDF bytes — the valid signature-stamped copy
 *  when one exists, else the original. Null when the order has no external BOL. */
export async function fetchExternalBolPdf(
  ref: DnShipmentRef
): Promise<{ bytes: Uint8Array; signed: boolean; source: 'dashboard' | 'erpnext' | 'signed' } | null> {
  const state = await getExternalBolState(ref)
  if (state.signedPath) {
    const { data } = await supabaseAdmin.storage.from(PO_DOC_BUCKET).download(state.signedPath)
    if (data) return { bytes: new Uint8Array(await data.arrayBuffer()), signed: true, source: 'signed' }
  }
  if (!state.original) return null
  const original = await fetchOriginalExternalBol(ref)
  if (!original) return null
  return {
    bytes: await externalBolToPdf(original.bytes, original.contentType),
    signed: false,
    source: original.source,
  }
}
