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
    'limit_page_length=25',
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
}

interface ItemRow {
  item_code: string
  item_name: string
  stock_uom: string
}

interface BinRow {
  item_code: string
  warehouse: string
  actual_qty: number
}

async function fetchItems(filterParam: string): Promise<ItemRow[]> {
  const qs = [
    filterParam,
    listParam('fields', ['item_code', 'item_name', 'stock_uom']),
    'limit_page_length=60',
  ].join('&')
  const resp = await erpnextGet<{ data: ItemRow[] }>(`/api/resource/Item?${qs}`)
  return resp.data ?? []
}

export async function locateItems(query: string): Promise<LocateResult[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const like = `%${escapeLike(q)}%`

  // 1) Items matching by code OR name (case-insensitive LIKE) — display info.
  const items = await fetchItems(
    listParam('or_filters', [
      ['item_code', 'like', like],
      ['item_name', 'like', like],
    ])
  )

  // 2) Stocked bins whose item_code matches q directly. This guarantees parts
  // that actually hold stock surface even when the item match above is capped
  // (a broad term like "EB" can match dozens of zero-stock variants first).
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

  // 2b) Pallet-id match. A scanned/typed pallet code IS a Batch name; resolve it
  // to its item so the part's card surfaces. Pallet ids are pure base32 (no dots
  // or spaces), so we only run this extra lookup when q could be one — part-number
  // and location searches (which contain '.', ' ', etc.) skip it.
  let palletItemCodes: string[] = []
  if (/^[0-9A-Za-z]{3,12}$/.test(q)) {
    const batchQs = [
      listParam('or_filters', [['name', 'like', like]]),
      listParam('fields', ['item']),
      'limit_page_length=10',
    ].join('&')
    const batches = (await erpnextGet<{ data: { item: string }[] }>(`/api/resource/Batch?${batchQs}`)).data ?? []
    palletItemCodes = batches.map((b) => b.item).filter(Boolean)
  }

  // Full code set = name/code matches + any stocked code found directly + items
  // behind a matching pallet id. Cap it so the `in` filters below can't produce
  // an over-long GET URL.
  const codeSet = new Set<string>(items.map((i) => i.item_code))
  for (const b of stockedByCode) codeSet.add(b.item_code)
  for (const c of palletItemCodes) codeSet.add(c)
  if (codeSet.size === 0) return []
  const codes = [...codeSet].slice(0, MAX_CODES)
  const codeAllow = new Set(codes)

  // 3) Display info for stocked codes not already described.
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
  return Array.from(byItem.values()).sort(
    (a, b) => b.total - a.total || a.itemName.localeCompare(b.itemName)
  )
}
