import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
import fs from 'fs'
const envPath = new URL('../.env.local', import.meta.url).pathname
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim() }
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function fetchGviz(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`
  const res = await fetch(url)
  const text = await res.text()
  // Strip the JSONP wrapper: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
  const data = JSON.parse(jsonStr)
  return data.table.rows.map(r => r.c.map(c => c ? c.v : null))
}

function num(v) {
  if (v == null || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function str(v) {
  if (v == null) return null
  return String(v).trim() || null
}

async function importIndividualItems() {
  console.log('--- Importing BOM 1: Individual Items ---')
  const rows = await fetchGviz(1330839591)
  console.log(`Fetched ${rows.length} rows`)

  const items = rows.filter(r => r[0]).map(r => ({
    part_number: str(r[0]),
    description: str(r[1]),
    cost_per_unit: num(r[2]),
    unit: 'lb', // default, some are 'ea' but sheet doesn't specify
    supplier: str(r[3]),
  }))

  console.log(`Inserting ${items.length} individual items...`)
  
  // Clear existing
  await supabase.from('bom_individual_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  
  // Insert in batches of 50
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50)
    const { error } = await supabase.from('bom_individual_items').upsert(batch, { onConflict: 'part_number' })
    if (error) console.error('Error inserting batch:', error.message)
  }
  
  console.log(`Done. Inserted ${items.length} individual items.`)
  return items
}

async function importSubAssemblies(individualItems) {
  console.log('\n--- Importing BOM 2: Sub Assemblies ---')
  const rows = await fetchGviz(1127983291)
  console.log(`Fetched ${rows.length} rows`)

  // Build cost lookup from individual items
  const costLookup = {}
  individualItems.forEach(item => {
    costLookup[item.part_number] = item.cost_per_unit
  })

  // Clear existing
  await supabase.from('bom_sub_assembly_components').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('bom_sub_assemblies').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  let insertedCount = 0
  for (const row of rows) {
    const partNumber = str(row[0])
    if (!partNumber) continue

    // Columns: A=Part, B=Category, C=Mold, D=Weight
    // E,F,G = Comp1 name/qty/cost ... S = end of comp 5
    // T=Material cost, U=Parts/hr, V=Labor$/hr, W=Employees, X=Labor/part, Y=Overhead, Z=Total
    const assembly = {
      part_number: partNumber,
      category: str(row[1]),
      mold_name: str(row[2]),
      part_weight: num(row[3]),
      material_cost: num(row[19]), // T
      parts_per_hour: num(row[20]), // U
      labor_rate_per_hour: num(row[21]), // V
      num_employees: num(row[22]), // W
      labor_cost_per_part: num(row[23]), // X
      overhead_cost: num(row[24]), // Y
      total_cost: num(row[25]), // Z
    }

    const { data: inserted, error } = await supabase
      .from('bom_sub_assemblies')
      .upsert(assembly, { onConflict: 'part_number' })
      .select('id')
      .single()

    if (error) {
      console.error(`Error inserting sub-assembly ${partNumber}:`, error.message)
      continue
    }

    // Extract components (5 groups of 3 cols starting at col E=4)
    const components = []
    for (let c = 0; c < 5; c++) {
      const baseIdx = 4 + c * 3
      const compName = str(row[baseIdx])
      if (!compName) continue
      
      const qty = num(row[baseIdx + 1])
      const sheetCost = num(row[baseIdx + 2])
      const isScrap = compName.toLowerCase().includes('scrap')
      
      components.push({
        sub_assembly_id: inserted.id,
        component_part_number: compName,
        quantity: qty,
        cost: sheetCost,
        is_scrap: isScrap,
        scrap_rate: isScrap ? 0.10 : null,
        sort_order: c,
      })
    }

    if (components.length > 0) {
      const { error: compError } = await supabase.from('bom_sub_assembly_components').insert(components)
      if (compError) console.error(`Error inserting components for ${partNumber}:`, compError.message)
    }

    insertedCount++
  }

  console.log(`Done. Inserted ${insertedCount} sub-assemblies.`)
}

async function importFinalAssemblies() {
  console.log('\n--- Importing BOM 3: Final Assemblies ---')
  const rows = await fetchGviz(308947416)
  console.log(`Fetched ${rows.length} rows`)

  // Get sub assembly part numbers to determine component_source
  const { data: subAssemblies } = await supabase.from('bom_sub_assemblies').select('part_number')
  const subAssemblyParts = new Set((subAssemblies || []).map(s => s.part_number))

  // Clear existing
  await supabase.from('bom_final_assembly_components').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('bom_final_assemblies').delete().neq('id', '00000000-0000-0000-0000-000000000000')

  // Column mapping:
  // 0=Part name, 1=Product Category, 2=Description, 3=Notes, 4=Sub-Product Category, 5=Parts per package
  // 6-8=Comp1(name,qty,cost), 9-11=Comp2, 12-14=Comp3, 15-17=Comp4, 18-20=Comp5
  // 21-23=Comp6, 24-26=Comp7, 27-29=Comp8, 30-32=Comp9, 33-35=Comp10
  // 36-38=Comp11, 39-41=Comp12, 42-44=Comp13
  // 45=Parts/hr, 46=Labor$/hr, 47=Employees, 48=Labor/part, 49=Shipping labor
  // 50=Subtotal, 51=OH%, 52=OH cost, 53=Admin%, 54=Admin cost
  // 55=Depreciation%, 56=Depreciation cost, 57=R&S%, 58=R&S cost
  // 59=Variable cost, 60=Total cost, 61=Profit target%, 62=Profit amount, 63=Sales target

  let insertedCount = 0
  for (const row of rows) {
    const partNumber = str(row[0])
    if (!partNumber) continue

    const assembly = {
      part_number: partNumber,
      product_category: str(row[1]),
      description: str(row[2]),
      notes: str(row[3]),
      sub_product_category: str(row[4]),
      parts_per_package: row[5] ? Math.round(num(row[5])) : null,
      parts_per_hour: num(row[45]),
      labor_rate_per_hour: num(row[46]),
      num_employees: num(row[47]),
      labor_cost_per_part: num(row[48]),
      shipping_labor_cost: num(row[49]),
      subtotal_cost: num(row[50]),
      overhead_pct: num(row[51]),
      overhead_cost: num(row[52]),
      admin_pct: num(row[53]),
      admin_cost: num(row[54]),
      depreciation_pct: num(row[55]),
      depreciation_cost: num(row[56]),
      repairs_pct: num(row[57]),
      repairs_cost: num(row[58]),
      variable_cost: num(row[59]),
      total_cost: num(row[60]),
      profit_target_pct: num(row[61]),
      profit_amount: num(row[62]),
      sales_target: num(row[63]),
    }

    const { data: inserted, error } = await supabase
      .from('bom_final_assemblies')
      .upsert(assembly, { onConflict: 'part_number' })
      .select('id')
      .single()

    if (error) {
      console.error(`Error inserting final assembly ${partNumber}:`, error.message)
      continue
    }

    // Extract 13 components (groups of 3 starting at col 6)
    const components = []
    for (let c = 0; c < 13; c++) {
      const baseIdx = 6 + c * 3
      const compName = str(row[baseIdx])
      if (!compName) continue

      const qty = num(row[baseIdx + 1])
      const cost = num(row[baseIdx + 2])
      
      // Components 1-3 (c=0,1,2) reference sub-assemblies, 4-13 reference individual items
      // But verify by checking if part exists in sub_assemblies
      const source = subAssemblyParts.has(compName) ? 'sub_assembly' : 'individual_item'

      components.push({
        final_assembly_id: inserted.id,
        component_part_number: compName,
        component_source: source,
        quantity: qty,
        cost: cost,
        sort_order: c,
      })
    }

    if (components.length > 0) {
      const { error: compError } = await supabase.from('bom_final_assembly_components').insert(components)
      if (compError) console.error(`Error inserting components for ${partNumber}:`, compError.message)
    }

    insertedCount++
  }

  console.log(`Done. Inserted ${insertedCount} final assemblies.`)
}

async function main() {
  console.log('Starting BOM data import...\n')
  
  const individualItems = await importIndividualItems()
  await importSubAssemblies(individualItems)
  await importFinalAssemblies()
  
  // Verify
  const { count: c1 } = await supabase.from('bom_individual_items').select('*', { count: 'exact', head: true })
  const { count: c2 } = await supabase.from('bom_sub_assemblies').select('*', { count: 'exact', head: true })
  const { count: c3 } = await supabase.from('bom_final_assemblies').select('*', { count: 'exact', head: true })
  
  console.log('\n=== Import Summary ===')
  console.log(`Individual Items: ${c1}`)
  console.log(`Sub Assemblies: ${c2}`)
  console.log(`Final Assemblies: ${c3}`)
}

main().catch(console.error)
