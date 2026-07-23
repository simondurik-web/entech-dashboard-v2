import { supabaseAdmin } from '@/lib/supabase-admin'

// PostgREST's silent 1,000-row cap applies to set-returning FUNCTIONS too, not
// just table selects — the daily rollup emits one row per (day, source, part,
// service), so a year of history overflows the cap and would silently truncate
// totals. Page every rollup read with a stable order, same as table reads.
export async function rpcAllRows<T>(
  fn: string,
  args: Record<string, string>,
  orderCols: string[],
): Promise<{ data: T[]; error: null } | { data: null; error: { message: string } }> {
  const out: T[] = []
  const pageSize = 1000
  let offset = 0
  for (;;) {
    let query = supabaseAdmin.rpc(fn, args)
    for (const col of orderCols) query = query.order(col, { ascending: true })
    const { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error) return { data: null, error }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return { data: out, error: null }
}
