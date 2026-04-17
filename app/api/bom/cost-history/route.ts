import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Unified cost/lead-time change log across all BOM item types.
// Auth is enforced client-side via AccessGuard (consistent with other BOM API routes).

const VALID_ITEM_TYPES = new Set(['individual', 'sub', 'final'])

export interface CostChangeLogEntry {
  id: string
  bom_item_id: string
  item_type: 'individual' | 'sub' | 'final'
  part_number: string | null
  item_description: string | null
  changed_field: string
  old_value: number | null
  new_value: number | null
  pct_change: number | null
  changed_by: string | null
  changed_at: string
  affected_assemblies: unknown
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 2000)
    const offset = parseInt(searchParams.get('offset') || '0')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const itemType = searchParams.get('item_type')
    const changeType = searchParams.get('change_type')
    const q = searchParams.get('q')?.trim() || ''

    let query = supabaseAdmin
      .from('bom_cost_history_with_details')
      .select('*', { count: 'exact' })
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (itemType && VALID_ITEM_TYPES.has(itemType)) {
      query = query.eq('item_type', itemType)
    }

    if (changeType === 'lead_time') {
      query = query.eq('changed_field', 'lead_time')
    } else if (changeType === 'cost') {
      query = query.neq('changed_field', 'lead_time')
    }

    if (from) query = query.gte('changed_at', from)
    if (to) query = query.lte('changed_at', to)

    if (q) {
      const esc = q.replace(/[%,]/g, '')
      query = query.or(`part_number.ilike.%${esc}%,item_description.ilike.%${esc}%`)
    }

    const { data, error, count } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const entries: CostChangeLogEntry[] = (data || []).map((row) => {
      const oldVal = row.old_value === null ? null : Number(row.old_value)
      const newVal = row.new_value === null ? null : Number(row.new_value)
      const pct =
        oldVal !== null && newVal !== null && oldVal !== 0
          ? Math.round(((newVal - oldVal) / oldVal) * 10000) / 100
          : null

      return {
        id: String(row.id),
        bom_item_id: String(row.bom_item_id),
        item_type: row.item_type as 'individual' | 'sub' | 'final',
        part_number: row.part_number ?? null,
        item_description: row.item_description ?? null,
        changed_field: String(row.changed_field),
        old_value: oldVal,
        new_value: newVal,
        pct_change: pct,
        changed_by: row.changed_by ?? null,
        changed_at: String(row.changed_at),
        affected_assemblies: row.affected_assemblies ?? null,
      }
    })

    return NextResponse.json(
      { entries, total: count ?? entries.length, limit, offset },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch cost change log'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
