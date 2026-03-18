import { NextResponse } from 'next/server'
import { fetchBOM, GIDS } from '@/lib/google-sheets'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [sheetsBom, supabaseResult] = await Promise.all([
    fetchBOM(GIDS.bomFinal),
    supabaseAdmin
      .from('bom_final_assemblies')
      .select('part_number, product_category, parts_per_package, total_cost, material_cost, packaging_cost, labor_energy_cost')
      .order('part_number'),
  ])

  const sheetsPartNumbers = new Set(sheetsBom.map((b) => b.partNumber))
  const supabaseOnly = (supabaseResult.data || []).filter((row) => !sheetsPartNumbers.has(row.part_number))

  return NextResponse.json({
    sheetsCount: sheetsBom.length,
    supabaseCount: supabaseResult.data?.length ?? 0,
    supabaseError: supabaseResult.error,
    supabaseOnlyCount: supabaseOnly.length,
    supabaseOnlyParts: supabaseOnly.map(r => r.part_number),
    has668inSheets: sheetsBom.filter(b => b.partNumber.startsWith('668')).map(b => b.partNumber),
    has668inSupabase: (supabaseResult.data || []).filter(r => r.part_number.startsWith('668')).map(r => r.part_number),
  })
}
