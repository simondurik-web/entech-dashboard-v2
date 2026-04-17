import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Note: Auth is enforced client-side via AccessGuard (consistent with all BOM API routes).
// Server-side auth for BOM routes is tracked as a future improvement.

const VALID_TYPES = ['individual', 'sub', 'final'] as const
type ItemType = (typeof VALID_TYPES)[number]

// Map short type names to their source tables for part_number lookup
const TABLE_MAP: Record<ItemType, string> = {
  individual: 'bom_individual_items',
  sub: 'bom_sub_assemblies',
  final: 'bom_final_assemblies',
}

interface CostHistoryEntry {
  id: string
  changed_at: string
  changed_field: string
  old_value: number
  new_value: number
  pct_change: number
  cause_item_id?: string
  cause_item_part_number?: string
  changed_by?: string | null
  changed_by_email?: string | null
  changed_by_name?: string | null
}

interface CostStats {
  first_cost: number
  last_cost: number
  total_changes: number
  overall_pct_change: number
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const { type, id } = await params

  // Validate type parameter
  if (!VALID_TYPES.includes(type as ItemType)) {
    return NextResponse.json(
      { error: `Invalid type "${type}". Must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    )
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    return NextResponse.json({ error: 'Invalid item ID format' }, { status: 400 })
  }

  const itemType = type as ItemType
  const tableName = TABLE_MAP[itemType]

  try {
    // Fetch the item's part number
    const { data: item, error: itemError } = await supabaseAdmin
      .from(tableName)
      .select('part_number')
      .eq('id', id)
      .single()

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    // Fetch cost history from the view
    const { data: history, error: historyError } = await supabaseAdmin
      .from('bom_cost_history_with_details')
      .select('*')
      .eq('bom_item_id', id)
      .eq('item_type', itemType)
      .order('changed_at', { ascending: false })

    if (historyError) {
      return NextResponse.json({ error: historyError.message }, { status: 500 })
    }

    // Transform into CostHistoryEntry[]
    const entries: CostHistoryEntry[] = (history || []).map((row: Record<string, unknown>) => {
      const oldVal = Number(row.old_value) || 0
      const newVal = Number(row.new_value) || 0
      const pctChange = oldVal !== 0 ? ((newVal - oldVal) / oldVal) * 100 : 0

      // Extract cause info from affected_assemblies JSONB if available
      const affectedAssemblies = row.affected_assemblies as Array<Record<string, unknown>> | null
      const causeItemId = affectedAssemblies?.[0]?.cause_item_id
        ? String(affectedAssemblies[0].cause_item_id)
        : undefined
      const causePartNumber = affectedAssemblies?.[0]?.cause_part_number
        ? String(affectedAssemblies[0].cause_part_number)
        : undefined

      return {
        id: String(row.id),
        changed_at: String(row.changed_at),
        changed_field: String(row.changed_field),
        old_value: oldVal,
        new_value: newVal,
        pct_change: Math.round(pctChange * 100) / 100,
        cause_item_id: causeItemId,
        cause_item_part_number: causePartNumber,
        changed_by: (row.changed_by as string | null) ?? null,
        changed_by_email: (row.changed_by_email as string | null) ?? null,
        changed_by_name: (row.changed_by_name as string | null) ?? null,
      }
    })

    // Compute stats using only total_cost entries to avoid mixing unrelated fields
    const totalCostEntries = entries.filter(e => e.changed_field === 'total_cost')
    const stats: CostStats = computeStats(totalCostEntries.length > 0 ? totalCostEntries : entries)

    return NextResponse.json(
      {
        itemId: id,
        itemType: itemType,
        partNumber: item.part_number,
        history: entries,
        stats,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function computeStats(entries: CostHistoryEntry[]): CostStats {
  if (entries.length === 0) {
    return { first_cost: 0, last_cost: 0, total_changes: 0, overall_pct_change: 0 }
  }

  // entries are sorted desc (newest first)
  const lastCost = entries[0].new_value
  const firstCost = entries[entries.length - 1].old_value || entries[entries.length - 1].new_value
  const overallPct = firstCost !== 0 ? ((lastCost - firstCost) / firstCost) * 100 : 0

  return {
    first_cost: firstCost,
    last_cost: lastCost,
    total_changes: entries.length,
    overall_pct_change: Math.round(overallPct * 100) / 100,
  }
}
