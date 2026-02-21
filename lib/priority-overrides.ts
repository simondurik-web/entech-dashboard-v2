/**
 * Fetch priority overrides from the dedicated priority_overrides table.
 * These survive the Sheets→Supabase sync cycle (which TRUNCATEs dashboard_orders).
 */
import { supabase } from './supabase'

export interface PriorityOverride {
  line: string
  priority_override: string
  changed_by: string | null
  changed_at: string | null
}

export async function fetchPriorityOverrides(): Promise<Map<string, PriorityOverride>> {
  const { data, error } = await supabase
    .from('priority_overrides')
    .select('line, priority_override, changed_by, changed_at')

  if (error) {
    console.warn('Failed to fetch priority overrides:', error.message)
    return new Map()
  }

  const map = new Map<string, PriorityOverride>()
  for (const row of data || []) {
    map.set(String(row.line), row as PriorityOverride)
  }
  return map
}

/**
 * Merge priority overrides into an array of orders.
 * Mutates orders in-place for performance.
 */
export function mergePriorityOverrides<T extends { line: string; priorityOverride: string | null; priorityChangedBy: string | null; priorityChangedAt: string | null }>(
  orders: T[],
  overrides: Map<string, PriorityOverride>
): T[] {
  if (overrides.size === 0) return orders

  for (const order of orders) {
    const override = overrides.get(order.line)
    if (override) {
      order.priorityOverride = override.priority_override
      order.priorityChangedBy = override.changed_by
      order.priorityChangedAt = override.changed_at
    }
  }
  return orders
}
