import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { getFullInventory, listCatalogItems } from '@/lib/erpnext/inventory'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

// GET /api/erpnext/inventory/report
// The full item × bin × qty matrix for the whole facility. Read-only; the client
// builds the grouped (By Bin / By Product) Excel workbook from it.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// The full export enriches every pallet across the facility (bounded concurrency), so it
// can run long on a large inventory — allow up to 5 min (Vercel clamps to the plan max).
export const maxDuration = 300

async function fetchAllRows(table: string, orderCols: string[], date?: string): Promise<Record<string, unknown>[]> {
  // PostgREST caps at 1000 rows by default — paginate to get all. Stable
  // ordering by unique key columns is required: without an explicit order,
  // .range() pages can overlap or skip rows.
  const allRows: Record<string, unknown>[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    let query = supabase.from(table).select('*')
    if (date) query = query.eq('date', date)
    for (const col of orderCols) query = query.order(col, { ascending: true })
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Supabase ${table} error: ${error.message}`)
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

async function fetchAllRowsAtSnapshot(
  table: string,
  orderCols: string[],
  snapshotTs: string
): Promise<Record<string, unknown>[]> {
  const allRows: Record<string, unknown>[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    let query = supabase.from(table).select('*').eq('snapshot_ts', snapshotTs)
    for (const col of orderCols) query = query.order(col, { ascending: true })
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Supabase ${table} error: ${error.message}`)
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

function etDayBounds(date: string): { start: string; end: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const midnight = (day: string) => {
    for (const offset of ['-04:00', '-05:00']) {
      const instant = new Date(`${day}T00:00:00${offset}`)
      const parts = formatter.formatToParts(instant)
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((value) => value.type === type)?.value ?? ''
      if (
        `${part('year')}-${part('month')}-${part('day')}` === day &&
        part('hour') === '00' &&
        part('minute') === '00'
      ) {
        return instant.toISOString()
      }
    }
    throw new Error(`Could not resolve ET midnight for ${day}`)
  }
  const [year, month, day] = date.split('-').map(Number)
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  return { start: midnight(date), end: midnight(nextDate) }
}

const snapshotTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function snapshotTimeLabel(snapshotTs: string): string {
  return snapshotTimeFormatter.format(new Date(snapshotTs))
}

async function intradaySnapshotTimes(date: string): Promise<string[]> {
  const { start, end } = etDayBounds(date)
  const { data, error } = await supabase.rpc('intraday_snapshot_times', {
    day_start: start,
    day_end: end,
  })
  if (error) throw new Error(`Supabase intraday_snapshot_times error: ${error.message}`)
  return (data ?? []).map((timestamp: unknown) => String(timestamp))
}

/** A part with no bin row, carrying the quantity we actually believe it has: 0 for a
 *  live catalog part, and for a dated export whatever that day's product snapshot says
 *  when the bin snapshot has no row for it. The quantity is never assumed. */
interface BinlessItem {
  itemCode: string
  itemName: string
  uom: string
  qty: number
}

/** Every live catalog part with no stock at all, as a zero-qty entry. The client folds
 *  these into the By Product tab so the export lists every part number in ERPNext, in
 *  stock or not — accounting VLOOKUPs it, and a part that vanishes when it hits zero
 *  reads as "no such part" instead of "we're out".
 *
 *  LIVE REPORTS ONLY. A dated export zero-fills from that day's product snapshot
 *  (see `historicalResponse`) — filling it from today's catalog would date parts back
 *  to before they existed and quietly drop parts that have since been disabled.
 *
 *  `stockedCodes` comes from `getFullInventory`, which returns every NON-ZERO bin — so
 *  a part ERPNext believes is at −5 is already in that set and is never zero-filled.
 *  Reporting a negative on-hand as 0 would be a wrong number, worse than the missing row
 *  this change fixes.
 *
 *  Fails soft, but never silently: on a fetch error OR an empty catalog (never
 *  legitimate — the facility always has parts) the caller reports
 *  `binlessItemsUnavailable` so a short file is visibly short. */
async function zeroStockCatalogItems(stockedCodes: Set<string>): Promise<{ items: BinlessItem[]; unavailable: boolean }> {
  try {
    const catalog = await listCatalogItems()
    if (catalog.length === 0) {
      console.error('inventory report: item catalog came back empty, exporting without zero-qty items')
      return { items: [], unavailable: true }
    }
    const items = catalog
      .filter((item) => !stockedCodes.has(item.itemCode))
      .map((item) => ({
        itemCode: item.itemCode,
        itemName: item.itemName,
        uom: item.uom,
        qty: 0,
      }))
    return { items, unavailable: false }
  } catch (error) {
    console.error('inventory report: catalog fetch failed, exporting without zero-qty items:', error)
    return { items: [], unavailable: true }
  }
}

async function historicalResponse(
  history: Record<string, unknown>[],
  binsAvailable: boolean,
  date: string,
  productHistory: Record<string, unknown>[],
  snapshotTime?: string
) {
  // A valid product-level snapshot includes zero-qty rows, so a fully empty result
  // means the snapshot never ran for that date — say so instead of exporting a blank
  // file. (The BIN snapshot stores only non-zero bins; that difference is what
  // `productHistory` below is for.)
  if (history.length === 0) {
    return NextResponse.json(
      { error: snapshotTime ? 'no snapshot for time' : 'no snapshot for date' },
      { status: 404 }
    )
  }
  const reference = await fetchAllRows('inventory_reference', ['fusion_id'])
  const names = new Map(
    reference.map((row) => {
      const partNumber = String(row.fusion_id ?? '')
      return [partNumber, String(row.description ?? '').trim() || partNumber]
    })
  )
  const rows = history.map((row) => {
    const itemCode = String(row.part_number ?? '')
    return {
      warehouse: binsAvailable ? String(row.warehouse ?? '') : '',
      itemCode,
      itemName: names.get(itemCode) ?? itemCode,
      uom: '',
      qty: Number(row.quantity ?? 0),
      pallets: [],
    }
  })

  // Zero-fill a dated export from THAT DAY's product snapshot, never from today's
  // ERPNext catalog: the dated file has to say what existed then, not now. The bin
  // snapshot the rows come from stores only non-zero bins (1,164 rows / 492 parts for
  // 2026-07-29), while the product snapshot carries the zeros (1,175 rows, 683 of them
  // zero) — so without this merge a dated By Product tab drops exactly the parts this
  // whole change is about. When bin history is missing, `history` IS the product
  // snapshot and every code is already in `stocked`, so this yields nothing.
  const stocked = new Set(rows.map((row) => row.itemCode))
  // Keyed, not appended. The snapshot is one row per part per date today (1,175 rows,
  // 1,175 distinct codes on 2026-07-29), but if that ever stopped holding, a plain push
  // would let arrival order decide — and the client keeps the first entry per code, so a
  // stray 0 arriving ahead of the real quantity would win in silence. SUM duplicates:
  // this is a total, and two rows for one part are two parts' worth of it.
  const binless = new Map<string, BinlessItem>()
  for (const row of productHistory) {
    const itemCode = String(row.part_number ?? '')
    if (!itemCode || stocked.has(itemCode)) continue
    const raw = Number(row.quantity ?? 0)
    const qty = Number.isFinite(raw) ? raw : 0
    const running = binless.get(itemCode)
    if (running) running.qty += qty
    else binless.set(itemCode, { itemCode, itemName: names.get(itemCode) ?? itemCode, uom: '', qty })
  }
  const binlessItems = [...binless.values()]
  // Usually every one of these is zero. When one isn't, the two snapshots disagree — the
  // product snapshot has stock the bin snapshot has no row for (4 parts on 2026-07-29).
  // The product-level number is the right one for a product-level tab, so it is carried
  // through rather than flattened to 0 or dropped; By Bin genuinely has nothing to show.
  const missingWithStock = binlessItems.filter((item) => item.qty !== 0).length
  if (missingWithStock > 0) {
    console.warn(
      `inventory report ${date}${snapshotTime ? ` ${snapshotTime}` : ''}: ${missingWithStock} part(s) have stock in the product snapshot but no bin row — exported on By Product with the product-level qty, absent from By Bin`
    )
  }
  // Bins present but no product snapshot for that date means the zeros can't be
  // recovered — flag it so the file is visibly short instead of quietly short.
  const binlessUnavailable = binsAvailable && productHistory.length === 0
  if (binlessUnavailable) {
    console.error(
      `inventory report ${date}${snapshotTime ? ` ${snapshotTime}` : ''}: bin snapshot exists but the product snapshot is empty — exporting without zero-qty parts`
    )
  }

  return NextResponse.json(
    {
      rows,
      binlessItems,
      binlessItemsUnavailable: binlessUnavailable,
      historical: true,
      binsAvailable,
      legacyData: date < '2026-07-21',
      ...(snapshotTime ? { snapshotTime } : {}),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

function todayInEasternTime(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function isRealDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [year, month, day] = date.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const date = req.nextUrl.searchParams.get('date')
  const time = req.nextUrl.searchParams.get('time')
  const times = req.nextUrl.searchParams.get('times')
  const today = todayInEasternTime()
  if (date !== null && (!isRealDate(date) || date > today)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }
  if ((time !== null || times !== null) && (!date || date === today)) {
    return NextResponse.json({ error: 'time requires a historical date' }, { status: 400 })
  }
  if (time !== null && !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: 'invalid time' }, { status: 400 })
  }

  try {
    if (date && date !== today) {
      if (times === '1') {
        const availableTimes = (await intradaySnapshotTimes(date)).map(snapshotTimeLabel)
        return NextResponse.json({ availableTimes })
      }
      if (time) {
        const snapshotTs = (await intradaySnapshotTimes(date)).find(
          (timestamp) => snapshotTimeLabel(timestamp) === time
        )
        if (!snapshotTs) {
          return NextResponse.json({ error: 'no snapshot for time' }, { status: 404 })
        }
        const binHistory = await fetchAllRowsAtSnapshot(
          'inventory_bin_history_intraday',
          ['part_number', 'warehouse'],
          snapshotTs
        )
        const binsAvailable = binHistory.length >= 1
        // Always read the product snapshot: it is the row set when bin history is
        // missing, and the source of the zero rows when it isn't.
        const productHistory = await fetchAllRowsAtSnapshot(
          'inventory_history_intraday',
          ['part_number'],
          snapshotTs
        )
        const history = binsAvailable ? binHistory : productHistory
        return await historicalResponse(history, binsAvailable, date, productHistory, time)
      }
      const binHistory = await fetchAllRows('inventory_bin_history', ['part_number', 'warehouse'], date)
      const binsAvailable = binHistory.length >= 1
      const productHistory = await fetchAllRows('inventory_history', ['part_number'], date)
      const history = binsAvailable ? binHistory : productHistory
      return await historicalResponse(history, binsAvailable, date, productHistory)
    }

    const rows = await getFullInventory()
    // An empty Bin result is not proof the facility is empty — a changed filter, a
    // permission change or an ERPNext regression looks identical here. Zero-filling on
    // top of it would produce a fully plausible workbook stating that all 1,142 parts
    // are at zero, which is the worst possible output of this feature: confidently
    // wrong. No bins, no zero-fill, and the page says the file is incomplete.
    if (rows.length === 0) {
      console.error('inventory report: ERPNext returned no bins at all — exporting without zero-qty parts')
      return NextResponse.json(
        { rows, binlessItems: [], binlessItemsUnavailable: true },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }
    const zero = await zeroStockCatalogItems(new Set(rows.map((row) => row.itemCode)))
    return NextResponse.json(
      { rows, binlessItems: zero.items, binlessItemsUnavailable: zero.unavailable },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('inventory report failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
