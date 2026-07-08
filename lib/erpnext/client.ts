// Server-only ERPNext REST client.
//
// Talks to the home-mini ERPNext instance through the Cloudflare Access gate
// on erp.4molding.com. Three pieces of auth, all from server env (never
// NEXT_PUBLIC_, so they are never bundled to the browser):
//   - CF-Access-Client-Id / CF-Access-Client-Secret  (passes Cloudflare Access)
//   - Authorization: token <key>:<secret>             (ERPNext dashboard-svc user)
//
// This module must only be imported from server code (route handlers / server
// actions). It reads secrets and would leak them if imported client-side.
//
// Background: this is the live feed that replaces the old Fusion CSV -> email
// -> Google Sheet pipeline. ERPNext is the source of truth; the dashboard reads
// it directly.

const BASE = process.env.ERPNEXT_BASE_URL
const API_KEY = process.env.ERPNEXT_API_KEY
const API_SECRET = process.env.ERPNEXT_API_SECRET
const CF_ID = process.env.CF_ACCESS_CLIENT_ID
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET

function authHeaders(): Record<string, string> {
  if (!BASE || !API_KEY || !API_SECRET || !CF_ID || !CF_SECRET) {
    throw new Error(
      'ERPNext env vars missing (need ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET)'
    )
  }
  return {
    'CF-Access-Client-Id': CF_ID,
    'CF-Access-Client-Secret': CF_SECRET,
    Authorization: `token ${API_KEY}:${API_SECRET}`,
    Accept: 'application/json',
  }
}

/** Low-level GET against the ERPNext REST API. `path` starts with `/api/...`.
 *  Bounded by an 8s timeout so a slow/hung ERPNext can't pin a Vercel function. */
export async function erpnextGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ERPNext GET ${path} -> ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

/** Low-level PUT against the ERPNext REST API — partial doc update; `body` is
 *  just the fields to set. Same 8s bound as erpnextGet. */
export async function erpnextPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ERPNext PUT ${path} -> ${res.status} ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

/** Raw GET (non-JSON) against ERPNext — used to stream binary assets (item
 *  pictures, PDFs) that sit behind the Cloudflare Access gate. Returns the raw
 *  Response; the caller checks res.ok and forwards body + content-type. */
export async function erpnextFetchRaw(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
}

/** Multipart upload to frappe's upload_file, attaching a file to a document.
 *  Content-Type is set by fetch from the FormData boundary — do not set it. */
export async function erpnextUploadFile(input: {
  fileName: string
  bytes: ArrayBuffer | Uint8Array
  attachedToDoctype: string
  attachedToName: string
  isPrivate?: boolean
  contentType?: string // default application/pdf; pass the real type for photos
}): Promise<{ name: string; file_url: string }> {
  const form = new FormData()
  const bytes = input.bytes instanceof Uint8Array ? new Uint8Array(input.bytes) : new Uint8Array(input.bytes)
  form.set('file', new Blob([bytes as BlobPart], { type: input.contentType ?? 'application/pdf' }), input.fileName)
  form.set('doctype', input.attachedToDoctype)
  form.set('docname', input.attachedToName)
  form.set('is_private', input.isPrivate === false ? '0' : '1')
  const res = await fetch(`${BASE}/api/method/upload_file`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ERPNext upload_file -> ${res.status} ${t.slice(0, 300)}`)
  }
  const j = (await res.json()) as { message: { name: string; file_url: string } }
  return j.message
}

/** Best-effort human message out of an ERPNext error body. Frappe packs the
 *  user-facing text (often bilingual, with HTML) into _server_messages. */
export function parseErpErrorMessage(raw: string): string {
  const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  try {
    const bodyStart = raw.indexOf('{')
    const body = JSON.parse(raw.slice(bodyStart)) as { _server_messages?: string; exception?: string }
    if (body._server_messages) {
      const msgs = (JSON.parse(body._server_messages) as string[]).map((m) => {
        try {
          return stripTags((JSON.parse(m) as { message?: string }).message ?? m)
        } catch {
          return stripTags(m)
        }
      })
      const joined = msgs.filter(Boolean).join(' — ')
      if (joined) return joined
    }
    if (body.exception) return stripTags(body.exception.split(':').slice(1).join(':') || body.exception)
  } catch {
    /* fall through to raw */
  }
  return stripTags(raw).slice(0, 300)
}

/** Escape SQL LIKE metacharacters so a user typing % or _ doesn't broaden the
 *  match (or hammer ERPNext). MariaDB default escape char is backslash. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

// Cap the code set used in `in` filters so the GET URL can't blow past
// Cloudflare/ERPNext URL limits on a broad search.
const MAX_CODES = 100

/** Warehouses/bins for the Add form (non-group, enabled). Optional name filter. */
export async function listWarehouses(query?: string): Promise<string[]> {
  const filters: unknown[] = [
    ['is_group', '=', 0],
    ['disabled', '=', 0],
  ]
  const q = query?.trim()
  if (q) filters.push(['name', 'like', `%${escapeLike(q)}%`])
  const qs = [
    listParam('filters', filters),
    listParam('fields', ['name']),
    'order_by=name asc',
    'limit_page_length=0',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Warehouse?${qs}`)
  return (r.data ?? []).map((w) => w.name)
}

/** All stockable, enabled items (part numbers) for the inventory part-number picker.
 *  Ordered by code; the client filters as the user types. */
export async function listAllItems(): Promise<{ itemCode: string; itemName: string }[]> {
  const qs = [
    listParam('filters', [
      ['disabled', '=', 0],
      ['is_stock_item', '=', 1],
    ]),
    listParam('fields', ['item_code', 'item_name']),
    'order_by=item_code asc',
    'limit_page_length=0',
  ].join('&')
  const r = await erpnextGet<{ data: { item_code: string; item_name: string }[] }>(`/api/resource/Item?${qs}`)
  return (r.data ?? []).map((i) => ({ itemCode: i.item_code, itemName: i.item_name }))
}

/** Item search for the Add form picker (code or name). */
export async function searchItems(
  query: string
): Promise<{ itemCode: string; itemName: string }[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const like = `%${escapeLike(q)}%`
  const qs = [
    listParam('or_filters', [
      ['item_code', 'like', like],
      ['item_name', 'like', like],
    ]),
    listParam('fields', ['item_code', 'item_name']),
    'order_by=item_code asc',
    'limit_page_length=50',
  ].join('&')
  const r = await erpnextGet<{ data: { item_code: string; item_name: string }[] }>(
    `/api/resource/Item?${qs}`
  )
  return (r.data ?? []).map((i) => ({ itemCode: i.item_code, itemName: i.item_name }))
}

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

/** Low-level write (POST/PUT) against the ERPNext REST API. */
async function erpnextSend<T = unknown>(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`ERPNext ${method} ${path} -> ${res.status} ${t.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

/** Create a doc: POST /api/resource/<Doctype>. Returns the saved doc. */
export async function erpnextCreate<T = Record<string, unknown>>(
  doctype: string,
  doc: Record<string, unknown>
): Promise<T> {
  const r = await erpnextSend<{ data: T }>('POST', `/api/resource/${encodeURIComponent(doctype)}`, doc)
  return r.data
}

/** Fetch a single doc fresh (needed before submit — see the recipe). */
export async function erpnextGetDoc<T = Record<string, unknown>>(
  doctype: string,
  name: string
): Promise<T> {
  const r = await erpnextGet<{ data: T }>(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
  )
  return r.data
}

/** Submit a (freshly fetched) doc. Submitting the original POST payload throws
 *  TimestampMismatchError — always pass a re-fetched doc. */
export async function erpnextSubmit<T = Record<string, unknown>>(doc: unknown): Promise<T> {
  const r = await erpnextSend<{ message: T }>('POST', `/api/method/frappe.client.submit`, {
    doc: JSON.stringify(doc),
  })
  return r.message
}

/** Cancel a submitted doc. */
export async function erpnextCancel(doctype: string, name: string): Promise<void> {
  await erpnextSend('POST', `/api/method/frappe.client.cancel`, { doctype, name })
}

/** Patch fields on an existing doc: PUT /api/resource/<Doctype>/<name>. */
export async function erpnextUpdate<T = Record<string, unknown>>(
  doctype: string,
  name: string,
  patch: Record<string, unknown>
): Promise<T> {
  const r = await erpnextSend<{ data: T }>(
    'PUT',
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    patch
  )
  return r.data
}

/** Run a whitelisted controller method on a document (Frappe's run_doc_method).
 *  `args` is JSON-encoded into the `args` field, which the handler parses and spreads as
 *  kwargs onto the method (so the method's parameter names must match `args`' keys). Used
 *  for methods that aren't plain resource writes — e.g. Sales Order.create_stock_reservation_entries.
 *  The dt/dn form skips the timestamp check, so no re-fetch is needed. */
export async function erpnextRunDocMethod<T = unknown>(
  dt: string,
  dn: string,
  method: string,
  args: Record<string, unknown>
): Promise<T> {
  const r = await erpnextSend<{ message?: T }>('POST', `/api/method/run_doc_method`, {
    dt,
    dn,
    method,
    args: JSON.stringify(args),
  })
  return r.message as T
}

/** Call a whitelisted GET method, e.g. get_batch_qty. */
export async function erpnextCallGet<T = unknown>(
  method: string,
  params: Record<string, string>
): Promise<T> {
  const qs = new URLSearchParams(params).toString()
  return erpnextGet<T>(`/api/method/${method}?${qs}`)
}

// ─── Search by location ───
// Type a part (code or name, e.g. "Trio A") and get every bin holding it,
// with per-bin quantity, live from ERPNext's Bin doctype.

export interface BinLocation {
  warehouse: string
  qty: number
}

export interface LocateResult {
  itemCode: string
  itemName: string
  uom: string
  total: number
  bins: BinLocation[]
  pallets?: { batch: string; warehouse: string; qty: number }[] // attached by the locate route
  hasBatch: boolean // serialized (pallet) vs non-serialized (quantity) item
}

export interface LocateResponse {
  results: LocateResult[]
  matchedPallet: string | null // set when the query exactly matched a pallet id (scan)
}

interface ItemRow {
  item_code: string
  item_name: string
  stock_uom: string
  has_batch_no?: number
}

interface BinRow {
  item_code: string
  warehouse: string
  actual_qty: number
}

async function fetchItems(filterParam: string): Promise<ItemRow[]> {
  const qs = [
    filterParam,
    listParam('fields', ['item_code', 'item_name', 'stock_uom', 'has_batch_no']),
    'limit_page_length=60',
  ].join('&')
  const resp = await erpnextGet<{ data: ItemRow[] }>(`/api/resource/Item?${qs}`)
  return resp.data ?? []
}

export async function locateItems(query: string): Promise<LocateResponse> {
  const q = query.trim()
  if (q.length < 2) return { results: [], matchedPallet: null }

  const like = `%${escapeLike(q)}%`

  // 0) EXACT pallet-id match wins. A scanned/typed pallet code is a Batch name; if
  // it matches exactly, show ONLY that pallet's item (never a broad list) so the
  // operator can't accidentally edit the wrong part. No fuzzy batch matching — that
  // surfaced several unrelated parts and was a safety hazard (Simon 2026-06-21).
  let matchedPallet: string | null = null
  const items: ItemRow[] = []
  const codeSet = new Set<string>()

  if (/^[0-9A-Za-z-]{3,20}$/.test(q)) {
    const exactQs = [
      listParam('filters', [['name', '=', q]]),
      listParam('fields', ['name', 'item']),
      'limit_page_length=1',
    ].join('&')
    const eb = (await erpnextGet<{ data: { name: string; item: string }[] }>(`/api/resource/Batch?${exactQs}`)).data?.[0]
    if (eb?.item) {
      matchedPallet = eb.name
      codeSet.add(eb.item)
    }
  }

  if (!matchedPallet) {
    // Part search: items matching by code OR name.
    items.push(
      ...(await fetchItems(
        listParam('or_filters', [
          ['item_code', 'like', like],
          ['item_name', 'like', like],
        ])
      ))
    )
    // Stocked bins whose item_code matches q directly (so stocked parts surface even
    // when a broad term matches dozens of zero-stock variants first).
    const binByCodeQs = [
      listParam('filters', [
        ['item_code', 'like', like],
        ['actual_qty', '>', 0],
      ]),
      listParam('fields', ['item_code', 'warehouse', 'actual_qty']),
      'limit_page_length=0',
    ].join('&')
    const stockedByCode =
      (await erpnextGet<{ data: BinRow[] }>(`/api/resource/Bin?${binByCodeQs}`)).data ?? []
    for (const i of items) codeSet.add(i.item_code)
    for (const b of stockedByCode) codeSet.add(b.item_code)
  }

  if (codeSet.size === 0) return { results: [], matchedPallet }
  const codes = [...codeSet].slice(0, MAX_CODES)
  const codeAllow = new Set(codes)

  // Display info for codes not already described.
  const described = new Set(items.map((i) => i.item_code))
  const missing = codes.filter((c) => !described.has(c))
  if (missing.length > 0) {
    const extra = await fetchItems(listParam('filters', [['item_code', 'in', missing]]))
    items.push(...extra)
  }

  // 4) All bins (with stock) for the full code set, in one call.
  const binQs = [
    listParam('filters', [
      ['item_code', 'in', codes],
      ['actual_qty', '>', 0],
    ]),
    listParam('fields', ['item_code', 'warehouse', 'actual_qty']),
    'limit_page_length=0',
  ].join('&')
  const binsResp = await erpnextGet<{ data: BinRow[] }>(`/api/resource/Bin?${binQs}`)
  const bins = binsResp.data ?? []

  const byItem = new Map<string, LocateResult>()
  for (const it of items) {
    if (!codeAllow.has(it.item_code) || byItem.has(it.item_code)) continue
    byItem.set(it.item_code, {
      itemCode: it.item_code,
      itemName: it.item_name,
      uom: it.stock_uom,
      total: 0,
      bins: [],
      hasBatch: !!it.has_batch_no,
    })
  }
  for (const b of bins) {
    const entry = byItem.get(b.item_code)
    if (!entry) continue
    entry.bins.push({ warehouse: b.warehouse, qty: b.actual_qty })
    entry.total += b.actual_qty
  }
  for (const entry of byItem.values()) {
    entry.bins.sort((a, b) => b.qty - a.qty)
  }

  // Items with stock first (by total desc), then the rest alphabetically.
  const results = Array.from(byItem.values()).sort(
    (a, b) => b.total - a.total || a.itemName.localeCompare(b.itemName)
  )
  return { results, matchedPallet }
}
