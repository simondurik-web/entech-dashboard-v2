import { supabaseAdmin } from './supabase-admin'

// Recalculate sub assembly costs from its components
export async function recalculateSubAssembly(subAssemblyId: string) {
  const { data: assembly } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .select('*')
    .eq('id', subAssemblyId)
    .single()
  if (!assembly) return null

  const { data: components } = await supabaseAdmin
    .from('bom_sub_assembly_components')
    .select('*')
    .eq('sub_assembly_id', subAssemblyId)
    .order('sort_order')

  if (!components) return assembly

  // Get individual item costs
  const partNumbers = components.map(c => c.component_part_number)
  const { data: items } = await supabaseAdmin
    .from('bom_individual_items')
    .select('part_number, cost_per_unit')
    .in('part_number', partNumbers)

  const costLookup: Record<string, number> = {}
  items?.forEach(i => { costLookup[i.part_number] = Number(i.cost_per_unit) })

  // First pass: non-scrap components
  let nonScrapTotal = 0
  for (const comp of components) {
    if (comp.is_scrap) continue
    const unitCost = costLookup[comp.component_part_number] || 0
    const cost = Number(comp.quantity) * unitCost
    await supabaseAdmin.from('bom_sub_assembly_components').update({ cost }).eq('id', comp.id)
    nonScrapTotal += cost
  }

  // Second pass: scrap components
  let scrapTotal = 0
  for (const comp of components) {
    if (!comp.is_scrap) continue
    const rate = Number(comp.scrap_rate) || 0.10
    const cost = nonScrapTotal * rate
    await supabaseAdmin.from('bom_sub_assembly_components').update({ cost }).eq('id', comp.id)
    scrapTotal += cost
  }

  const material_cost = nonScrapTotal + scrapTotal
  const labor_cost_per_part = assembly.parts_per_hour > 0
    ? (Number(assembly.num_employees) * Number(assembly.labor_rate_per_hour)) / Number(assembly.parts_per_hour)
    : 0
  const total_cost = material_cost + labor_cost_per_part + Number(assembly.overhead_cost)

  const { data: updated } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .update({ material_cost, labor_cost_per_part, total_cost })
    .eq('id', subAssemblyId)
    .select()
    .single()

  return updated
}

// Recalculate final assembly costs
export async function recalculateFinalAssembly(finalAssemblyId: string) {
  const { data: assembly } = await supabaseAdmin
    .from('bom_final_assemblies')
    .select('*')
    .eq('id', finalAssemblyId)
    .single()
  if (!assembly) return null

  const { data: components } = await supabaseAdmin
    .from('bom_final_assembly_components')
    .select('*')
    .eq('final_assembly_id', finalAssemblyId)
    .order('sort_order')

  if (!components) return assembly

  // Get costs from sub assemblies and individual items
  const subParts = components.filter(c => c.component_source === 'sub_assembly').map(c => c.component_part_number)
  const indParts = components.filter(c => c.component_source === 'individual_item').map(c => c.component_part_number)

  const subCosts: Record<string, number> = {}
  const indCosts: Record<string, number> = {}

  if (subParts.length) {
    const { data } = await supabaseAdmin.from('bom_sub_assemblies').select('part_number, total_cost').in('part_number', subParts)
    data?.forEach(s => { subCosts[s.part_number] = Number(s.total_cost) })
  }
  if (indParts.length) {
    const { data } = await supabaseAdmin.from('bom_individual_items').select('part_number, cost_per_unit').in('part_number', indParts)
    data?.forEach(i => { indCosts[i.part_number] = Number(i.cost_per_unit) })
  }

  // Update component costs
  let componentTotal = 0
  for (const comp of components) {
    const unitCost = comp.component_source === 'sub_assembly'
      ? (subCosts[comp.component_part_number] || 0)
      : (indCosts[comp.component_part_number] || 0)
    const cost = Number(comp.quantity) * unitCost
    await supabaseAdmin.from('bom_final_assembly_components').update({ cost }).eq('id', comp.id)
    componentTotal += cost
  }

  const subtotal_cost = componentTotal + Number(assembly.labor_cost_per_part) + Number(assembly.shipping_labor_cost)
  
  const oh = Number(assembly.overhead_pct)
  const ad = Number(assembly.admin_pct)
  const dp = Number(assembly.depreciation_pct)
  const rp = Number(assembly.repairs_pct)
  const pt = Number(assembly.profit_target_pct)

  const overhead_cost = oh > 0 ? subtotal_cost / (1 - oh) - subtotal_cost : 0
  const admin_cost = ad > 0 ? subtotal_cost / (1 - ad) - subtotal_cost : 0
  const depreciation_cost = dp > 0 ? subtotal_cost / (1 - dp) - subtotal_cost : 0
  const repairs_cost = rp > 0 ? subtotal_cost / (1 - rp) - subtotal_cost : 0

  const variable_cost = subtotal_cost + admin_cost + repairs_cost
  const total_cost = subtotal_cost + overhead_cost + admin_cost + depreciation_cost + repairs_cost
  const profit_amount = pt > 0 ? total_cost / (1 - pt) - total_cost : 0
  const sales_target = total_cost + profit_amount

  const { data: updated } = await supabaseAdmin
    .from('bom_final_assemblies')
    .update({
      subtotal_cost, overhead_cost, admin_cost, depreciation_cost, repairs_cost,
      variable_cost, total_cost, profit_amount, sales_target,
    })
    .eq('id', finalAssemblyId)
    .select()
    .single()

  return updated
}

// Cascade: when individual item cost changes, recalculate all affected sub & final assemblies
export async function recalculateCascade(changedItemType: 'individual_item' | 'sub_assembly' | 'final_assembly', changedItemId: string) {
  if (changedItemType === 'individual_item') {
    // Get the part number
    const { data: item } = await supabaseAdmin.from('bom_individual_items').select('part_number').eq('id', changedItemId).single()
    if (!item) return

    // Find all sub assemblies using this item
    const { data: subComps } = await supabaseAdmin
      .from('bom_sub_assembly_components')
      .select('sub_assembly_id')
      .eq('component_part_number', item.part_number)

    const subIds = [...new Set(subComps?.map(c => c.sub_assembly_id) || [])]
    
    // Recalculate each sub assembly
    const updatedSubParts: string[] = []
    for (const subId of subIds) {
      const updated = await recalculateSubAssembly(subId)
      if (updated) updatedSubParts.push(updated.part_number)
    }

    // Find all final assemblies using these sub assemblies OR the individual item directly
    const { data: finalComps } = await supabaseAdmin
      .from('bom_final_assembly_components')
      .select('final_assembly_id')
      .or(`component_part_number.eq.${item.part_number},component_part_number.in.(${updatedSubParts.join(',')})`)

    const finalIds = [...new Set(finalComps?.map(c => c.final_assembly_id) || [])]
    for (const fId of finalIds) {
      await recalculateFinalAssembly(fId)
    }
  } else if (changedItemType === 'sub_assembly') {
    const { data: sub } = await supabaseAdmin.from('bom_sub_assemblies').select('part_number').eq('id', changedItemId).single()
    if (!sub) return

    const { data: finalComps } = await supabaseAdmin
      .from('bom_final_assembly_components')
      .select('final_assembly_id')
      .eq('component_part_number', sub.part_number)

    const finalIds = [...new Set(finalComps?.map(c => c.final_assembly_id) || [])]
    for (const fId of finalIds) {
      await recalculateFinalAssembly(fId)
    }
  } else if (changedItemType === 'final_assembly') {
    await recalculateFinalAssembly(changedItemId)
  }
}
