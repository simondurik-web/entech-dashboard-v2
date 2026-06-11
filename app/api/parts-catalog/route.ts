import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Catalog of every internal part we've ever quoted/mapped, independent of
// customer — feeds the generic-quote part picker. The dedicated `parts`
// table is empty; the real catalog lives in customer_part_mappings.

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('customer_part_mappings')
    .select('internal_part_number, category')
    .order('internal_part_number')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const seen = new Map<string, string | null>()
  for (const row of data ?? []) {
    const pn = (row.internal_part_number || '').trim()
    if (!pn) continue
    if (!seen.has(pn) || (!seen.get(pn) && row.category)) {
      seen.set(pn, row.category ?? null)
    }
  }

  const parts = Array.from(seen, ([partNumber, category]) => ({ partNumber, category }))

  return NextResponse.json(parts, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  })
}
