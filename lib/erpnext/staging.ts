import {
  erpnextGet,
  erpnextGetDoc,
  erpnextCreate,
  erpnextUpdate,
  erpnextRunDocMethod,
  erpnextCancel,
} from './client'
import { erpNow } from './erp-time'
import type { Committed } from './operation'

// "Prepare for staging" — reserve specific pallets (batches) to an open Sales Order in
// ERPNext so the physical stock is locked to that order before it ships. Company is fixed
// to Molding. All writes are server-side only.
//
// The reservation mechanism (validated on the live ERPNext server):
//   1. The SO Item must have reserve_stock=1 (backfilled on all open SO items).
//   2. Create a Serial and Batch Bundle (Outward / Stock Reservation Entry) listing the
//      batch + qty + warehouse to reserve. It stays a draft (docstatus 0) — the reservation
//      call only reads its entries, it is never submitted.
//   3. Call the Sales Order's whitelisted create_stock_reservation_entries via run_doc_method
//      with items_details pointing the SO Item at that bundle. ERPNext creates a submitted
//      Stock Reservation Entry (status "Reserved") and increases the SO Item's
//      stock_reserved_qty.
//   4. When total reserved >= total ordered across the SO, mark it Staged (custom fields).

const COMPANY = 'Molding'

function listParam(name: string, value: unknown): string {
  return `${name}=${encodeURIComponent(JSON.stringify(value))}`
}

/** Bounded-concurrency map so a wide SO fan-out can't fire hundreds of simultaneous calls. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const OPEN_SO_EXCLUDE = ['Completed', 'Closed', 'Cancelled', 'On Hold']
const SO_FETCH_CONCURRENCY = 6
// Max batches per SRE `in` filter, to keep the GET URL under ERPNext/Cloudflare limits.
const RES_BATCH_CHUNK = 100

interface SOItemRow {
  name: string
  idx?: number
  item_code: string
  warehouse?: string | null
  qty: number
  stock_qty?: number | null
  stock_reserved_qty?: number | null
  reserve_stock?: number | null
  delivered_qty?: number | null
  delivery_date?: string | null
}

/** Soonest per-line due date first (undated last), child-table order as tiebreak.
 *  Multi-release orders enter their release lines in arbitrary row order —
 *  SO-00016's row 1 was the October release while the July line sat at row 4,
 *  so anything that walks items in row order binds pallets to the wrong
 *  release (line 2491 stuck MAKING, Simon 2026-07-20). */
function byLineDueDate(a: SOItemRow, b: SOItemRow): number {
  return (
    (a.delivery_date ?? '9999-12-31').localeCompare(b.delivery_date ?? '9999-12-31') ||
    (a.idx ?? 0) - (b.idx ?? 0)
  )
}

interface SODoc {
  name: string
  customer: string
  po_no?: string | null
  delivery_date?: string | null
  status: string
  docstatus: number
  custom_staging_status?: string | null
  items: SOItemRow[]
}

/** Ordered qty of an SO Item in stock units (stock_qty when present, else qty). */
function orderedOf(it: SOItemRow): number {
  return Number(it.stock_qty ?? it.qty) || 0
}
function reservedOf(it: SOItemRow): number {
  return Number(it.stock_reserved_qty) || 0
}

/** One reservable release LINE of an order — what the operator actually picks.
 *  Multi-release orders carry the same item on several lines with different due
 *  dates; picking at the SO level let pallets bind to the wrong release
 *  (Simon 2026-07-20). `soItem` is the Sales Order Item child name, the exact
 *  reservation target. */
export interface StagingSoLine {
  soItem: string
  deliveryDate: string | null
  orderedQty: number
  reservedQty: number // reserved OR delivered (whichever is larger) for this line
  reservable: boolean // reserve_stock — staging targets only; a non-reservable
  // line is still listed for the add flow's informational SO attach
}

export interface StagingSalesOrder {
  name: string
  customer: string
  poNo: string | null
  orderedQty: number // for the queried item (sum of its lines on this SO)
  reservedQty: number // already reserved for that item
  deliveryDate: string | null
  stagingStatus: string | null // custom_staging_status: Open | Staged | Shipped (or null)
  lines: StagingSoLine[] // open (not fully consumed) lines, soonest due first; includes
  // non-reservable ones flagged reservable:false (add-flow informational attach)
}

/** Open Sales Orders that include `itemCode` as a line, each with that item's ordered-vs-
 *  reserved qty so the UI can show staging progress. The child doctype "Sales Order Item"
 *  is 403 for dashboard-svc, so we filter SO names with a child-table filter (allowed on the
 *  parent) and then read each SO's full doc for the line quantities. Submitted + still-open
 *  only. Read-only. */
export async function listOpenSalesOrdersForItem(itemCode: string): Promise<StagingSalesOrder[]> {
  const qs = [
    listParam('filters', [
      ['Sales Order Item', 'item_code', '=', itemCode],
      ['docstatus', '=', 1],
      ['status', 'not in', OPEN_SO_EXCLUDE],
    ]),
    listParam('fields', ['name']),
    'limit_page_length=200',
  ].join('&')
  const rows =
    (await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Sales Order?${qs}`)).data ?? []
  const names = [...new Set(rows.map((r) => r.name))]

  const orders = await mapLimit(names, SO_FETCH_CONCURRENCY, async (name) => {
    const doc = await erpnextGetDoc<SODoc>('Sales Order', name)
    let ordered = 0
    let used = 0
    const lines: StagingSoLine[] = []
    for (const it of doc.items ?? []) {
      if (it.item_code !== itemCode) continue
      const lineOrdered = orderedOf(it)
      // per line, what's spoken for: reserved OR already delivered (a manual
      // ERPNext ship without a reservation still consumes the line)
      const lineUsed = Math.max(reservedOf(it), Number(it.delivered_qty) || 0)
      ordered += lineOrdered
      used += lineUsed
      // Pickable lines only: not fully consumed. NOT filtered on reserve_stock —
      // non-serialized items attach an SO as label text only (no reservation),
      // and their lines may not be reservable; hiding them would empty the
      // add-pallet dropdown for those items. A reserve attempt against a
      // non-reservable line is caught by the whole-pallet verification.
      if (lineOrdered - lineUsed > 1e-6) {
        lines.push({
          soItem: it.name,
          deliveryDate: it.delivery_date ?? null,
          orderedQty: lineOrdered,
          reservedQty: lineUsed,
          reservable: !!it.reserve_stock,
        })
      }
    }
    lines.sort(
      (a, b) =>
        (a.deliveryDate ?? '9999-12-31').localeCompare(b.deliveryDate ?? '9999-12-31') ||
        a.soItem.localeCompare(b.soItem)
    )
    const order: StagingSalesOrder = {
      name: doc.name,
      customer: doc.customer,
      poNo: doc.po_no ?? null,
      orderedQty: ordered,
      reservedQty: used,
      deliveryDate: doc.delivery_date ?? null,
      stagingStatus: doc.custom_staging_status ?? null,
      lines,
    }
    return order
  })

  // An order whose need for THIS item is fully reserved OR shipped must not be
  // offered as a staging target at all — over-assigning stock to a covered
  // order was a real loophole (Simon 2026-07-03). Tiny epsilon vs float qty.
  const open = orders.filter((o) => o.orderedQty - o.reservedQty > 1e-6)

  // Soonest delivery first (undated last), then by name for stability.
  return open.sort(
    (a, b) =>
      (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999') || a.name.localeCompare(b.name)
  )
}

export interface StagingProgress {
  orderedQty: number // whole-SO totals (drives the Staged decision)
  reservedQty: number
  stagingStatus: string | null
  staged: boolean // reservedQty >= orderedQty
}

/** Whole-SO ordered-vs-reserved totals + whether it is fully covered (the Staged threshold). */
export async function getStagingProgress(soName: string): Promise<StagingProgress> {
  const doc = await erpnextGetDoc<SODoc>('Sales Order', soName)
  let ordered = 0
  let reserved = 0
  for (const it of doc.items ?? []) {
    ordered += orderedOf(it)
    reserved += reservedOf(it)
  }
  return {
    orderedQty: ordered,
    reservedQty: reserved,
    stagingStatus: doc.custom_staging_status ?? null,
    // Tiny epsilon so float rounding on stock_qty can't leave a fully-reserved order un-staged.
    staged: ordered > 0 && reserved >= ordered - 1e-6,
  }
}

// Active reservation statuses. Reserving a big SO line one pallet at a time makes each
// individual entry "Partially Reserved" (it covers only part of the line), so filtering to
// "Reserved" alone would miss real reservations and undercount the staged pallets.
const ACTIVE_SRE_STATUS = ['Reserved', 'Partially Reserved', 'Partially Delivered']

/** A pallet's live reservation to a Sales Order (from ERPNext Stock Reservation Entries). */
export type BatchReservation = {
  batch: string
  so: string
  soItem: string | null // Sales Order Item (release line) the reservation targets
  customer: string | null
  poNo: string | null
  reservedQty: number
  status: string
  sre: string // the Stock Reservation Entry name (needed to release/move it)
}

/**
 * For the given pallet batches, return which are reserved to a Sales Order — live from
 * ERPNext, so it reflects existing reservations, not just new ones. Bounded work: one
 * SRE list (child-table filter on the reserved batch), N full-doc reads to map each
 * matched SRE back to its batch (the child table isn't listable directly for
 * dashboard-svc), and one Sales Order lookup for customer/PO. Batches with no active
 * reservation are simply absent from the returned map.
 */
export async function reservationsForBatches(
  batches: string[]
): Promise<Record<string, BatchReservation>> {
  const uniq = Array.from(new Set(batches.map((b) => String(b ?? '').trim()).filter(Boolean)))
  const out: Record<string, BatchReservation> = {}
  if (uniq.length === 0) return out

  // 1) Active SREs whose reserved batch entries include any of our batches. Chunk the
  //    `in` filter (like MAX_CODES elsewhere) so a large bin never builds an over-long
  //    GET URL to ERPNext.
  const uniqSet = new Set(uniq)
  const chunks: string[][] = []
  for (let i = 0; i < uniq.length; i += RES_BATCH_CHUNK) chunks.push(uniq.slice(i, i + RES_BATCH_CHUNK))
  const sreLists = await mapLimit(chunks, SO_FETCH_CONCURRENCY, (chunk) => {
    const qs = [
      listParam('filters', [
        ['Serial and Batch Entry', 'batch_no', 'in', chunk],
        ['status', 'in', ACTIVE_SRE_STATUS],
        ['docstatus', '=', 1],
      ]),
      listParam('fields', ['name', 'voucher_no', 'voucher_detail_no', 'reserved_qty', 'status']),
      'limit_page_length=0',
    ].join('&')
    return erpnextGet<{
      data: { name: string; voucher_no: string; voucher_detail_no?: string | null; reserved_qty: number; status: string }[]
    }>(
      `/api/resource/Stock Reservation Entry?${qs}`
    ).then((r) => r.data ?? [])
  })
  // Dedup SREs by name (a batch can appear in only one chunk, but be defensive).
  const sres = Array.from(new Map(sreLists.flat().map((s) => [s.name, s])).values())
  if (sres.length === 0) return out

  // 2) Resolve each SRE back to the batch(es) it reserves (child table read via full doc).
  //    Concurrency-capped like the other ERPNext fan-outs so a big bin can't fire dozens
  //    of simultaneous full-doc GETs and blow the function timeout.
  const byBatch: Record<string, { so: string; soItem: string | null; reservedQty: number; status: string; sre: string }> = {}
  await mapLimit(sres, SO_FETCH_CONCURRENCY, async (s) => {
    try {
      const full = await erpnextGetDoc<{ sb_entries?: { batch_no: string; qty: number }[] }>(
        'Stock Reservation Entry',
        s.name
      )
      for (const e of full.sb_entries ?? []) {
        const b = String(e.batch_no ?? '').trim()
        if (b && uniqSet.has(b) && !byBatch[b]) {
          byBatch[b] = {
            so: s.voucher_no,
            soItem: s.voucher_detail_no ?? null,
            reservedQty: Number(e.qty) || Number(s.reserved_qty) || 0,
            status: s.status,
            sre: s.name,
          }
        }
      }
    } catch {
      /* skip a single unreadable SRE rather than fail the whole lookup */
    }
  })

  // 3) SO details (customer, PO) for the distinct sales orders.
  const soNames = Array.from(new Set(Object.values(byBatch).map((v) => v.so)))
  const soInfo: Record<string, { customer: string | null; poNo: string | null }> = {}
  if (soNames.length) {
    const sq = [
      listParam('filters', [['name', 'in', soNames]]),
      listParam('fields', ['name', 'customer', 'po_no']),
      'limit_page_length=0',
    ].join('&')
    const sos =
      (await erpnextGet<{ data: { name: string; customer: string | null; po_no: string | null }[] }>(
        `/api/resource/Sales Order?${sq}`
      )).data ?? []
    for (const so of sos) soInfo[so.name] = { customer: so.customer ?? null, poNo: so.po_no ?? null }
  }

  for (const [batch, v] of Object.entries(byBatch)) {
    out[batch] = {
      batch,
      so: v.so,
      soItem: v.soItem,
      customer: soInfo[v.so]?.customer ?? null,
      poNo: soInfo[v.so]?.poNo ?? null,
      reservedQty: v.reservedQty,
      status: v.status,
      sre: v.sre,
    }
  }
  return out
}

/** Release ONE pallet's reservation (cancel its Stock Reservation Entry) and
 *  recompute the source order's staging state: losing a pallet drops a fully-
 *  staged order back to Open so it shows as needing staging again. Used by the
 *  move-to-another-order flow (Simon 2026-07-03). */
export async function releaseBatchReservation(
  batch: string,
  expectedSre?: string
): Promise<{ released: boolean; fromSo?: string; customer?: string | null }> {
  const res = (await reservationsForBatches([batch]))[batch]
  if (!res) return { released: false }
  // Pinned release: cancel ONLY the reservation the caller confirmed. A
  // concurrent replacement reservation on the batch must never be cancelled
  // without operator confirmation (codex round-5 TOCTOU). Cancelling by the
  // PINNED name (not the re-resolved one) closes the check-to-cancel gap.
  if (expectedSre && res.sre !== expectedSre) {
    throw new Error(
      `Pallet ${batch}'s reservation changed since the operation was confirmed — re-scan and try again`
    )
  }
  // Never cancel an SRE that reserves MORE than this pallet — a manual ERPNext
  // reservation can bundle several batches into one entry, and cancelling it
  // would silently release sibling pallets nobody scanned (codex round-6).
  const full = await erpnextGetDoc<{ sb_entries?: { batch_no?: string | null }[] }>(
    'Stock Reservation Entry',
    res.sre
  )
  const distinctBatches = new Set(
    (full.sb_entries ?? []).map((e) => String(e.batch_no ?? '').trim()).filter(Boolean)
  )
  if (distinctBatches.size > 1) {
    throw new Error(
      `Pallet ${batch}'s reservation (${res.sre}) covers ${distinctBatches.size} pallets — it must be handled in ERPNext directly`
    )
  }
  await erpnextCancel('Stock Reservation Entry', expectedSre ?? res.sre)

  const fromSo = res.so
  const progress = await getStagingProgress(fromSo)
  const remaining = (await reservationNamesForSO(fromSo)).length
  if (!progress.staged && progress.stagingStatus === 'Staged') {
    await erpnextUpdate('Sales Order', fromSo, {
      custom_staging_status: 'Open',
      custom_staged_at: null,
      custom_staged_pallets: remaining,
    })
  } else {
    await erpnextUpdate('Sales Order', fromSo, { custom_staged_pallets: remaining })
  }
  return { released: true, fromSo, customer: res.customer }
}

/** Names of the active (Reserved / Partially Reserved) Stock Reservation Entries on an SO. */
async function reservationNamesForSO(soName: string): Promise<string[]> {
  const qs = [
    listParam('filters', [
      ['voucher_type', '=', 'Sales Order'],
      ['voucher_no', '=', soName],
      ['status', 'in', ACTIVE_SRE_STATUS],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', ['name']),
    'limit_page_length=0',
  ].join('&')
  const r = await erpnextGet<{ data: { name: string }[] }>(`/api/resource/Stock Reservation Entry?${qs}`)
  return (r.data ?? []).map((x) => x.name)
}

export interface ReserveInput {
  soName: string
  items: {
    salesOrderItem?: string // SO Item child name; resolved from soName+itemCode when omitted
    itemCode: string
    warehouse: string
    batch: string
    qty: number
  }[]
}

/** Reserve each pallet's batch to the Sales Order. For every pallet: create a Serial and Batch
 *  Bundle (Outward / Stock Reservation Entry) for its batch+qty+warehouse, then call the SO's
 *  create_stock_reservation_entries against the matching SO Item. Pallets are processed
 *  sequentially so each reservation sees the prior one's committed reserved qty (no double-count
 *  of an SO line's remaining capacity). After reserving, if the whole SO is fully covered it is
 *  marked Staged (custom_staging_status + custom_staged_at + custom_staged_pallets). Partial
 *  coverage is allowed and leaves the order Open. Returns how many new reservations were created
 *  and whether the order auto-staged. */
export async function reserveBatchesToSO(
  input: ReserveInput
): Promise<Committed & { reserved: number; staged: boolean; fullyReservedSoItems: string[]; allocations: Record<string, string> }> {
  const { soName, items } = input
  if (items.length === 0)
    return { stockEntry: null, reserved: 0, staged: false, fullyReservedSoItems: [], allocations: {}, extra: { reserved: 0, staged: false } }

  const so = await erpnextGetDoc<SODoc>('Sales Order', soName)
  if (so.docstatus !== 1 || OPEN_SO_EXCLUDE.includes(so.status)) {
    throw new Error(`Sales Order ${soName} is not open (status ${so.status})`)
  }

  const before = new Set(await reservationNamesForSO(soName))

  // Allocate each pallet to an SO LINE with room left, spilling to the next
  // line when one fills — multi-release orders carry the SAME item on several
  // lines (500+500+500+500), and pinning everything to the first line both
  // mis-attributed reservations and tripped the over-reserve guard after one
  // release's worth (found while creating SO-00077, 2026-07-03). Doubles as
  // the hard over-reserve guard (Simon 2026-07-03): nothing can be reserved
  // past what the order still needs, including across a multi-pallet queue.
  const runningReserved = new Map<string, number>()
  // Per line, consumed = the LARGER of reserved and delivered (a line shipped
  // manually in ERPNext has delivered > 0 with no reservation — without this,
  // the auto-finder pinned pallets to already-shipped lines; bug-hunt
  // 2026-07-04). Matches listOpenSalesOrdersForItem's remaining math.
  const remainingOf = (l: SOItemRow) =>
    orderedOf(l) - Math.max(runningReserved.get(l.name) ?? reservedOf(l), Number(l.delivered_qty) || 0)
  const allocations = new Map<string, string>() // batch -> SO Item name
  for (const p of items) {
    let line: SOItemRow | undefined
    if (p.salesOrderItem) {
      // A pinned line must satisfy the SAME invariants the auto path enforces:
      // right item and reservable — a crafted request must not aim a pallet at
      // another SKU's line or a non-reservable row (codex review, 2026-07-20).
      const pinned = (so.items ?? []).find((l) => l.name === p.salesOrderItem)
      if (!pinned || pinned.item_code !== p.itemCode || !pinned.reserve_stock) {
        throw new Error(
          `Sales Order ${soName} has no reservable line ${p.salesOrderItem} for item ${p.itemCode}`
        )
      }
      line = p.qty > remainingOf(pinned) + 1e-6 ? undefined : pinned
    } else {
      // SOONEST-DUE line of this item that can take the WHOLE pallet — never
      // child-table row order (see byLineDueDate; line 2491 stuck MAKING while
      // its pallets sat reserved to the October release, Simon 2026-07-20).
      line = (so.items ?? [])
        .filter((l) => l.item_code === p.itemCode && l.reserve_stock && p.qty <= remainingOf(l) + 1e-6)
        .sort(byLineDueDate)[0]
    }
    if (!line) {
      const itemLines = (so.items ?? []).filter((l) => l.item_code === p.itemCode && l.reserve_stock)
      if (itemLines.length === 0) {
        throw new Error(`Sales Order ${soName} has no reservable line for item ${p.itemCode}`)
      }
      const totalRemaining = itemLines.reduce((s, l) => s + Math.max(0, remainingOf(l)), 0)
      throw new Error(
        totalRemaining <= 1e-6
          ? `${soName} already has all of ${p.itemCode} reserved — nothing left to stage`
          : totalRemaining >= p.qty
            ? `Pallet ${p.batch} (${p.qty.toLocaleString()}) is larger than any single release line of ${soName} still open — use a smaller pallet or reduce its qty`
            : `${soName} only needs ${totalRemaining.toLocaleString()} more of ${p.itemCode}; pallet ${p.batch} holds ${p.qty.toLocaleString()}`
      )
    }
    // Seed from max(reserved, delivered) so a partially-delivered line's
    // remaining stays right across a multi-pallet queue.
    runningReserved.set(
      line.name,
      (runningReserved.get(line.name) ?? Math.max(reservedOf(line), Number(line.delivered_qty) || 0)) + p.qty
    )
    allocations.set(p.batch, line.name)
  }

  for (const p of items) {
    const salesOrderItem = allocations.get(p.batch)
    if (!salesOrderItem) {
      throw new Error(`Sales Order ${soName} has no reservable line for item ${p.itemCode}`)
    }
    // Serial and Batch Bundle stays a draft; create_stock_reservation_entries only reads it.
    const sbb = await erpnextCreate<{ name: string }>('Serial and Batch Bundle', {
      company: COMPANY,
      item_code: p.itemCode,
      warehouse: p.warehouse,
      type_of_transaction: 'Outward',
      voucher_type: 'Stock Reservation Entry',
      entries: [{ batch_no: p.batch, qty: p.qty, warehouse: p.warehouse }],
    })
    await erpnextRunDocMethod('Sales Order', soName, 'create_stock_reservation_entries', {
      items_details: [
        {
          sales_order_item: salesOrderItem,
          warehouse: p.warehouse,
          qty_to_reserve: p.qty,
          serial_and_batch_bundle: sbb.name,
        },
      ],
      notify: false,
    })
    // WHOLE-PALLET RULE (Simon 2026-07-04, option a): the reservation must
    // cover the pallet's FULL quantity — ERPNext caps a reservation at the
    // available/unreserved qty under a race, which would ship short on paper
    // while the physical pallet leaves whole. Verify what actually bound; on
    // shortfall, release it and stop with an actionable message.
    // NOTE: Stock Settings allow_partial_reservation must stay ON — ERPNext's
    // "partial" means partial-vs-the-LINE (per-pallet staging always is);
    // turning it off makes ERPNext silently SKIP every per-pallet reservation
    // (verified live 2026-07-04). The whole-pallet rule is enforced HERE.
    const bound = (await reservationsForBatches([p.batch]).catch(() => ({} as Record<string, BatchReservation>)))[p.batch]
    const boundQty = Number(bound?.reservedQty ?? 0)
    // WRONG-LINE backstop: a batch that already carried a reservation on a
    // DIFFERENT line (or one with UNKNOWN line ownership, soItem null) answers
    // this lookup with that pre-existing entry while our reserve bound nothing
    // (ERPNext silently skips an already-reserved batch) — without this check
    // that read as success and even dashboard-flipped the wrong line (codex
    // review, 2026-07-20; fail-closed on null soItem per round 2). Do NOT
    // release: the reservation found is not ours.
    const wantLine = allocations.get(p.batch)
    if (bound && wantLine && bound.soItem !== wantLine) {
      throw new Error(
        `Pallet ${p.batch} already carries a reservation on ${bound.so} that is not the targeted release line — move it explicitly or release it first`
      )
    }
    if (boundQty + 1e-6 < p.qty) {
      // Pinned to the short-bound SRE we just observed — never a reservation a
      // concurrent request created meanwhile (grok round-10). No observed SRE
      // (transient lookup failure) -> DON'T release blind: a dangling partial
      // the error message points at beats cancelling someone else's
      // reservation (codex round-11).
      if (bound) await releaseBatchReservation(p.batch, bound.sre).catch(() => undefined)
      throw new Error(
        `Pallet ${p.batch} could only be reserved for ${boundQty} of its ${p.qty} pcs — the order can't take the whole pallet. ` +
          `Whole pallets only: use a pallet that fits, or adjust/split the pallet to the needed quantity first.`
      )
    }
  }

  const after = await reservationNamesForSO(soName)
  const reserved = after.filter((n) => !before.has(n)).length

  // SO item rows this call filled to their FULL ordered qty — the instant
  // dashboard status flip is scoped to these (a partially-covered line must
  // stay Pending until the sync's reserved>=ordered check agrees).
  const fullyReservedSoItems = [...new Set(allocations.values())].filter((name) => {
    const line = (so.items ?? []).find((l) => l.name === name)
    return !!line && (runningReserved.get(name) ?? 0) + 1e-6 >= orderedOf(line)
  })

  // Auto-mark Staged when the whole SO is fully covered.
  const progress = await getStagingProgress(soName)
  let staged = false
  if (progress.staged && progress.stagingStatus !== 'Staged') {
    await erpnextUpdate('Sales Order', soName, {
      custom_staging_status: 'Staged',
      custom_staged_at: nowStamp(),
      custom_staged_pallets: after.length,
    })
    staged = true
  } else if (progress.stagingStatus === 'Staged') {
    // Already staged (e.g. a retry) — keep the pallet count current.
    await erpnextUpdate('Sales Order', soName, { custom_staged_pallets: after.length })
    staged = true
  }

  // allocations: which release line (SO Item) each batch actually bound to —
  // callers print it on the pallet label so the floor can match pallet → line.
  return {
    stockEntry: null,
    reserved,
    staged,
    fullyReservedSoItems,
    allocations: Object.fromEntries(allocations),
    extra: { reserved, staged },
  }
}

/** ERPNext-friendly "now" (YYYY-MM-DD HH:MM:SS, local server tz per Frappe convention). */
function nowStamp(): string {
  return erpNow()
}

export interface StagedOrder {
  name: string
  customer: string
  poNo: string | null
  stagedAt: string | null
  stagedPallets: number
  deliveryDate: string | null
}

/** Sales Orders currently marked Staged (custom_staging_status = 'Staged'). Read-only. */
export async function listStagedOrders(): Promise<StagedOrder[]> {
  const qs = [
    listParam('filters', [
      ['custom_staging_status', '=', 'Staged'],
      ['docstatus', '=', 1],
    ]),
    listParam('fields', [
      'name',
      'customer',
      'po_no',
      'custom_staged_at',
      'custom_staged_pallets',
      'delivery_date',
    ]),
    'order_by=custom_staged_at desc',
    'limit_page_length=200',
  ].join('&')
  const rows =
    (
      await erpnextGet<{
        data: {
          name: string
          customer: string
          po_no?: string | null
          custom_staged_at?: string | null
          custom_staged_pallets?: number | null
          delivery_date?: string | null
        }[]
      }>(`/api/resource/Sales Order?${qs}`)
    ).data ?? []
  return rows.map((r) => ({
    name: r.name,
    customer: r.customer,
    poNo: r.po_no ?? null,
    stagedAt: r.custom_staged_at ?? null,
    stagedPallets: Number(r.custom_staged_pallets) || 0,
    deliveryDate: r.delivery_date ?? null,
  }))
}

/** Release an order's reservations: cancel every Reserved Stock Reservation Entry on it and
 *  reset it to Open. Used by an optional "release" action. */
export async function cancelReservationsForSO(soName: string): Promise<{ cancelled: number }> {
  await erpnextRunDocMethod('Sales Order', soName, 'cancel_stock_reservation_entries', { notify: false })
  const remaining = await reservationNamesForSO(soName)
  await erpnextUpdate('Sales Order', soName, {
    custom_staging_status: 'Open',
    custom_staged_at: null,
    custom_staged_pallets: remaining.length,
  })
  return { cancelled: remaining.length === 0 ? 1 : 0 }
}
