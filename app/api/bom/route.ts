import { NextResponse } from 'next/server'
import { fetchBOM, GIDS } from '@/lib/google-sheets'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    const [sheetsBom, supabaseResult] = await Promise.all([
      fetchBOM(GIDS.bomFinal),
      supabaseAdmin
        .from('bom_final_assemblies')
        .select('part_number, product_category, parts_per_package, total_cost, material_cost, packaging_cost, labor_energy_cost')
        .order('part_number'),
    ])

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
        materialCost: row.material_cost || 0,
        packagingCost: row.packaging_cost || 0,
        laborEnergyCost: row.labor_energy_cost || 0,
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
