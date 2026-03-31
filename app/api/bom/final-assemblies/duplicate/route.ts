import { NextResponse } from 'next/server'
import { BomAuthoringError, createFinalAssembly } from '@/lib/bom-authoring'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: Request) {
  try {
    const { id, new_part_number, _performed_by_name, _performed_by_email } = await req.json()

    const { data: original, error } = await supabaseAdmin
      .from('bom_final_assemblies')
      .select('*, bom_final_assembly_components(*)')
      .eq('id', id)
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!original) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const duplicatedAssembly = await createFinalAssembly({
      part_number: new_part_number || `${original.part_number}-COPY`,
      product_category: original.product_category,
      sub_product_category: original.sub_product_category,
      description: original.description,
      notes: original.notes,
      parts_per_package: original.parts_per_package,
      parts_per_hour: original.parts_per_hour,
      labor_rate_per_hour: original.labor_rate_per_hour,
      num_employees: original.num_employees,
      shipping_labor_cost: original.shipping_labor_cost,
      overhead_pct: original.overhead_pct,
      admin_pct: original.admin_pct,
      depreciation_pct: original.depreciation_pct,
      repairs_pct: original.repairs_pct,
      profit_target_pct: original.profit_target_pct,
      components: (original.bom_final_assembly_components || []).map((component: Record<string, unknown>) => ({
        component_part_number: component.component_part_number,
        component_source: component.component_source,
        quantity: component.quantity,
      })),
    })

    // Audit log
    await supabaseAdmin.from('bom_audit').insert({
      entity_type: 'final_assembly',
      entity_id: duplicatedAssembly.id,
      action: 'duplicated',
      field_name: null,
      old_value: `Cloned from ${original.part_number}`,
      new_value: duplicatedAssembly.part_number,
      performed_by_name: _performed_by_name || null,
      performed_by_email: _performed_by_email || null,
    })

    return NextResponse.json(duplicatedAssembly)
  } catch (error) {
    if (error instanceof BomAuthoringError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    const message = error instanceof Error ? error.message : 'Failed to duplicate final assembly.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
