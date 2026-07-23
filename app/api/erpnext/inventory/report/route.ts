import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { getFullInventory } from '@/lib/erpnext/inventory'
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

async function historicalResponse(
  history: Record<string, unknown>[],
  binsAvailable: boolean,
  date: string,
  snapshotTime?: string
) {
  // Valid snapshots include zero-qty rows, so a fully empty result means the
  // snapshot never ran for that date — say so instead of exporting a blank file.
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
  return NextResponse.json(
    {
      rows,
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
        const history = binsAvailable
          ? binHistory
          : await fetchAllRowsAtSnapshot('inventory_history_intraday', ['part_number'], snapshotTs)
        return await historicalResponse(history, binsAvailable, date, time)
      }
      const binHistory = await fetchAllRows('inventory_bin_history', ['part_number', 'warehouse'], date)
      const binsAvailable = binHistory.length >= 1
      const history = binsAvailable
        ? binHistory
        : await fetchAllRows('inventory_history', ['part_number'], date)
      return await historicalResponse(history, binsAvailable, date)
    }

    const rows = await getFullInventory()
    return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('inventory report failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
