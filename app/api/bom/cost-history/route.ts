import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Unified cost/lead-time change log across all BOM item types.
// Auth is enforced client-side via AccessGuard (consistent with other BOM API routes).

const VALID_ITEM_TYPES = ['individual', 'sub', 'final'] as const
type ItemType = (typeof VALID_ITEM_TYPES)[number]

export interface CostChangeLogEntry {
  id: string
  bom_item_id: string
  item_type: ItemType
  part_number: string | null
  item_description: string | null
  changed_field: string
  old_value: number | null
  new_value: number | null
  pct_change: number | null
  changed_by: string | null
  changed_by_email: string | null
  changed_by_name: string | null
  changed_at: string
  affected_assemblies: unknown
}

type ChangeTypeFilter = 'lead_time' | 'cost' | null

interface QueryFilters {
  from: string | null
  to: string | null
  changeType: ChangeTypeFilter
  q: string
}

function buildQuery(itemType: ItemType | null, limit: number, filters: QueryFilters) {
  let q = supabaseAdmin
    .from('bom_cost_history_with_details')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit)

  if (itemType) q = q.eq('item_type', itemType)

  if (filters.changeType === 'lead_time') {
    q = q.eq('changed_field', 'lead_time')
  } else if (filters.changeType === 'cost') {
    q = q.neq('changed_field', 'lead_time')
  }

  if (filters.from) q = q.gte('changed_at', filters.from)
  if (filters.to) q = q.lte('changed_at', filters.to)

  if (filters.q) {
    const esc = filters.q.replace(/[%,]/g, '')
    q = q.or(`part_number.ilike.%${esc}%,item_description.ilike.%${esc}%`)
  }

  return q
}

function mapRows(rows: unknown[]): CostChangeLogEntry[] {
  return (rows as Record<string, unknown>[]).map((row) => {
    const oldVal = row.old_value === null || row.old_value === undefined ? null : Number(row.old_value)
    const newVal = row.new_value === null || row.new_value === undefined ? null : Number(row.new_value)
    const pct =
      oldVal !== null && newVal !== null && oldVal !== 0
        ? Math.round(((newVal - oldVal) / oldVal) * 10000) / 100
        : null

    return {
      id: String(row.id),
      bom_item_id: String(row.bom_item_id),
      item_type: row.item_type as ItemType,
      part_number: (row.part_number as string | null) ?? null,
      item_description: (row.item_description as string | null) ?? null,
      changed_field: String(row.changed_field),
      old_value: oldVal,
      new_value: newVal,
      pct_change: pct,
      changed_by: (row.changed_by as string | null) ?? null,
      changed_by_email: (row.changed_by_email as string | null) ?? null,
      changed_by_name: (row.changed_by_name as string | null) ?? null,
      changed_at: String(row.changed_at),
      affected_assemblies: row.affected_assemblies ?? null,
    }
  })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const requestedLimit = Math.min(parseInt(searchParams.get('limit') || '1000'), 3000)
    const rawItemType = searchParams.get('item_type')
    const itemType: ItemType | null =
      rawItemType && (VALID_ITEM_TYPES as readonly string[]).includes(rawItemType)
        ? (rawItemType as ItemType)
        : null

    const rawChangeType = searchParams.get('change_type')
    const changeType: ChangeTypeFilter =
      rawChangeType === 'lead_time' ? 'lead_time' : rawChangeType === 'cost' ? 'cost' : null

    const filters: QueryFilters = {
      from: searchParams.get('from'),
      to: searchParams.get('to'),
      changeType,
      q: searchParams.get('q')?.trim() || '',
    }

    let entries: CostChangeLogEntry[]

    if (itemType) {
      // Single type — straightforward paged query
      const { data, error } = await buildQuery(itemType, requestedLimit, filters)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      entries = mapRows(data || [])
    } else {
      // "All types" — fetch a balanced slice per type, then interleave by date.
      // Finals dominate the table ~90%, so a plain ORDER BY + LIMIT hides
      // individuals and subs entirely. Per-type fetch guarantees visibility.
      const perTypeLimit = Math.max(100, Math.ceil(requestedLimit / 3))
      const [ind, sub, fin] = await Promise.all([
        buildQuery('individual', perTypeLimit, filters),
        buildQuery('sub', perTypeLimit, filters),
        buildQuery('final', perTypeLimit, filters),
      ])
      const firstError = ind.error || sub.error || fin.error
      if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

      const merged = [
        ...mapRows(ind.data || []),
        ...mapRows(sub.data || []),
        ...mapRows(fin.data || []),
      ]
      merged.sort((a, b) => (a.changed_at < b.changed_at ? 1 : a.changed_at > b.changed_at ? -1 : 0))
      entries = merged.slice(0, requestedLimit)
    }

    return NextResponse.json(
      { entries, total: entries.length, limit: requestedLimit },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch cost change log'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
