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

async function fetchAllRows(table: string, date?: string): Promise<Record<string, unknown>[]> {
  // PostgREST caps at 1000 rows by default — paginate to get all
  const allRows: Record<string, unknown>[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    let query = supabase.from(table).select('*')
    if (date) query = query.eq('date', date)
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) throw new Error(`Supabase ${table} error: ${error.message}`)
    if (!data || data.length === 0) break
    allRows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return allRows
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
  const today = todayInEasternTime()
  if (date !== null && (!isRealDate(date) || date > today)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 })
  }

  try {
    if (date && date !== today) {
      const binHistory = await fetchAllRows('inventory_bin_history', date)
      const binsAvailable = binHistory.length >= 1
      const history = binsAvailable
        ? binHistory
        : await fetchAllRows('inventory_history', date)
      const reference = await fetchAllRows('inventory_reference')
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
        { rows, historical: true, binsAvailable, legacyData: date < '2026-07-21' },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const rows = await getFullInventory()
    return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('inventory report failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
