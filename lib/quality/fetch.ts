import { supabase } from "@/lib/supabase"
import { buildLimitsIndex, type LimitsIndex, type QaLimitRow } from "./limits"

const PAGE = 1000
const MAX_ROWS = 100_000

/**
 * Fetch every row of a Quality table, paging past PostgREST's 1000-row cap.
 * Reads go through the shared client under RLS (same as the standalone EQDR app).
 */
export async function fetchAllQa<T>(
  table: string,
  columns = "*",
  orderColumn = "timestamp",
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: false })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

/** Load qa_product_limits and build the spec-limit index for badge coloring. */
export async function fetchLimitsIndex(): Promise<LimitsIndex> {
  const rows = await fetchAllQa<QaLimitRow>("qa_product_limits", "product_type,product_number,metric_key,min_value,target_value,max_value", "product_number")
  return buildLimitsIndex(rows)
}
