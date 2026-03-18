import { NextResponse } from 'next/server'
import { fetchBOM, GIDS } from '@/lib/google-sheets'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [sheetsBom, supabaseResult] = await Promise.all([
      fetchBOM(GIDS.bomFinal),
      supabaseAdmin
        .from('bom_final_assemblies')
        .select('part_number, product_category, parts_per_package, total_cost, variable_cost, labor_cost_per_part')
        .order('part_number'),
    ])

    if (supabaseResult.error) {
      console.error('Supabase BOM query error:', supabaseResult.error)
    }

    // Merge Supabase final assemblies that aren't already in Sheets
    const sheetsPartNumbers = new Set(sheetsBom.map((b) => b.partNumber))
    const supabaseBom = (supabaseResult.data || [])
      .filter((row) => !sheetsPartNumbers.has(row.part_number))
      .map((row) => ({
        partNumber: row.part_number,
        product: row.product_category || 'Other',
        category: row.product_category || 'Other',
        qtyPerPallet: row.parts_per_package || 0,
        components: [],
        totalCost: row.total_cost || 0,
        materialCost: row.variable_cost || 0,
        packagingCost: 0,
        laborEnergyCost: row.labor_cost_per_part || 0,
      }))

    return NextResponse.json([...sheetsBom, ...supabaseBom])
  } catch (error) {
    console.error('Failed to fetch BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch BOM data' },
      { status: 500 }
    )
  }
}
