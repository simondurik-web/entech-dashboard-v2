import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// Load env
const envPath = path.resolve(process.cwd(), '.env.local')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
const BOM_FINAL_GID = '74377031'

// Configurable overhead percentages and profit target
const CONFIG = {
  overheadRate: 0.0191,
  adminExpenseRate: 0.1128,
  depreciationRate: 0.1055,
  repairsSuppliesRate: 0.0658,
  profitTarget: 0.20,
}

async function fetchBOMCosts() {
  // Fetch the BOM Final Assembly sheet via gviz
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${BOM_FINAL_GID}`
  const res = await fetch(url)
  const text = await res.text()
  // Strip JSONP wrapper
  const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, ''))
  const rows = json.table.rows

  // Col 0 = Part Number (A)
  // Col 59 = Variable Cost (BH)
  // Col 60 = Total Cost (BI)
  // Col 63 = Sales Target (BL)
  const costMap = new Map()

  for (const row of rows) {
    const cells = row.c
    if (!cells || !cells[0]?.v) continue
    const partNumber = String(cells[0].v).trim()
    
    const variableCost = parseNum(cells[59]?.v)
    const totalCost = parseNum(cells[60]?.v)
    const salesTarget = parseNum(cells[63]?.v)

    if (partNumber && (variableCost > 0 || totalCost > 0)) {
      costMap.set(partNumber, { variableCost, totalCost, salesTarget })
    }
  }

  console.log(`📊 Fetched ${costMap.size} BOM entries with cost data`)
  return costMap
}

function parseNum(v) {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[$,\s]/g, '')
  return parseFloat(s) || 0
}

function computeContributionLevel(lowestPrice, variableCost, totalCost, salesTarget) {
  if (!lowestPrice || lowestPrice <= 0) return null
  if (lowestPrice < variableCost) return 'Critical Loss'
  if (lowestPrice < totalCost) return 'Marginal Coverage'
  if (lowestPrice < salesTarget) return 'Net Profitable'
  return 'Target Achieved'
}

async function main() {
  console.log('🚀 Starting BOM cost import...')
  
  // Fetch BOM costs
  const costMap = await fetchBOMCosts()

  // Fetch all customer_part_mappings
  const { data: mappings, error } = await supabase
    .from('customer_part_mappings')
    .select('id, internal_part_number, tier1_price, tier2_price, tier3_price, tier4_price, tier5_price')

  if (error) {
    console.error('❌ Failed to fetch mappings:', error)
    process.exit(1)
  }

  console.log(`📋 Found ${mappings.length} customer part mappings`)

  let updated = 0, matched = 0, unmatched = 0

  for (const mapping of mappings) {
    const pn = mapping.internal_part_number?.trim()
    if (!pn) continue

    const bomCost = costMap.get(pn)
    
    // Compute lowest quoted price from tier prices
    const prices = [
      mapping.tier1_price,
      mapping.tier2_price,
      mapping.tier3_price,
      mapping.tier4_price,
      mapping.tier5_price,
    ].filter(p => p != null && p > 0)
    
    const lowestPrice = prices.length > 0 ? Math.min(...prices) : null

    const updateData = { lowest_quoted_price: lowestPrice }

    if (bomCost) {
      matched++
      updateData.variable_cost = bomCost.variableCost
      updateData.total_cost = bomCost.totalCost
      updateData.sales_target = bomCost.salesTarget
      updateData.contribution_level = computeContributionLevel(
        lowestPrice, bomCost.variableCost, bomCost.totalCost, bomCost.salesTarget
      )
    } else {
      unmatched++
      updateData.contribution_level = null
    }

    const { error: updateError } = await supabase
      .from('customer_part_mappings')
      .update(updateData)
      .eq('id', mapping.id)

    if (updateError) {
      console.error(`❌ Failed to update ${pn}:`, updateError.message)
    } else {
      updated++
      if (updated % 50 === 0) console.log(`   ... ${updated} updated`)
    }
  }

  console.log(`\n✅ Import complete:`)
  console.log(`   Updated: ${updated}`)
  console.log(`   BOM matched: ${matched}`)
  console.log(`   No BOM match: ${unmatched}`)
  
  // Show some sample results
  const { data: samples } = await supabase
    .from('customer_part_mappings')
    .select('internal_part_number, lowest_quoted_price, variable_cost, total_cost, sales_target, contribution_level')
    .not('contribution_level', 'is', null)
    .limit(5)
  
  if (samples?.length) {
    console.log('\n📋 Sample results:')
    for (const s of samples) {
      console.log(`   ${s.internal_part_number}: $${s.lowest_quoted_price} → ${s.contribution_level} (VC: $${s.variable_cost}, TC: $${s.total_cost}, ST: $${s.sales_target})`)
    }
  }
}

main().catch(console.error)
