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

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
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

  // Full code set = name/code matches + any stocked code found directly.
  // Cap it so the `in` filters below can't produce an over-long GET URL.
  const codeSet = new Set<string>(items.map((i) => i.item_code))
  for (const b of stockedByCode) codeSet.add(b.item_code)
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
