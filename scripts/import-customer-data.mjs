/**
 * Import Customer Reference Data from Google Sheets into Supabase
 * Tables: customers, customer_part_mappings
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

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
const GID = '336333220' // customerReference from google-sheets.ts

function cellValue(row, col) {
  const cell = row.c?.[col]
  if (!cell || cell.v === null || cell.v === undefined) return ''
  return String(cell.v).trim()
}

function cellNumber(row, col) {
  const cell = row.c?.[col]
  if (!cell || cell.v === null || cell.v === undefined) return null
  const raw = String(cell.v).replace(/[$,\s]/g, '')
  const n = parseFloat(raw)
  return isNaN(n) ? null : n
}

async function fetchSheetData() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`
  const res = await fetch(url)
  const text = await res.text()
  const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '')
  const data = JSON.parse(jsonStr)
  return data.table.rows
}

async function main() {
  console.log('Fetching Customer Reference data from Google Sheets...')
  const rows = await fetchSheetData()
  console.log(`Found ${rows.length} rows`)

  // Extract unique customers
  const customerMap = new Map() // name -> { paymentTerms, notes }
  for (const row of rows) {
    const name = cellValue(row, 0)
    if (!name) continue
    if (!customerMap.has(name)) {
      customerMap.set(name, {
        payment_terms: cellValue(row, 3) || 'Net 30',
        notes: cellValue(row, 4) || null,
      })
    }
  }

  console.log(`\nFound ${customerMap.size} unique customers`)

  // Clear existing data (fresh import)
  await supabase.from('customer_part_mappings').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  await supabase.from('customers').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  console.log('Cleared existing data')

  // Insert customers
  const customerInserts = []
  for (const [name, data] of customerMap) {
    customerInserts.push({ name, ...data })
  }
  
  const { data: insertedCustomers, error: custErr } = await supabase
    .from('customers')
    .upsert(customerInserts, { onConflict: 'name' })
    .select('id, name')
  
  if (custErr) {
    console.error('Error inserting customers:', custErr)
    process.exit(1)
  }
  console.log(`Inserted ${insertedCustomers.length} customers`)

  // Build name -> id map
  const custIdMap = new Map(insertedCustomers.map(c => [c.name, c.id]))

  // Insert customer part mappings
  const mappings = []
  for (const row of rows) {
    const customerName = cellValue(row, 0)
    const internalPart = cellValue(row, 2)
    if (!customerName || !internalPart) continue

    const customerId = custIdMap.get(customerName)
    if (!customerId) { console.warn(`No customer ID for: ${customerName}`); continue }

    mappings.push({
      customer_id: customerId,
      customer_part_number: cellValue(row, 1) || null,
      internal_part_number: internalPart,
      category: cellValue(row, 5) || null,
      package_quantity: cellValue(row, 6) || null,
      packaging: cellValue(row, 7) || null,
      tier1_range: cellValue(row, 8) || null,
      tier1_price: cellNumber(row, 9),
      tier2_range: cellValue(row, 10) || null,
      tier2_price: cellNumber(row, 11),
      tier3_range: cellValue(row, 12) || null,
      tier3_price: cellNumber(row, 13),
      tier4_range: cellValue(row, 14) || null,
      tier4_price: cellNumber(row, 15),
      tier5_range: cellValue(row, 16) || null,
      tier5_price: cellNumber(row, 17),
    })
  }

  // Insert in batches of 50
  let inserted = 0
  for (let i = 0; i < mappings.length; i += 50) {
    const batch = mappings.slice(i, i + 50)
    const { error } = await supabase.from('customer_part_mappings').insert(batch)
    if (error) {
      console.error(`Error inserting batch ${i}:`, error)
      // Try one by one
      for (const m of batch) {
        const { error: e2 } = await supabase.from('customer_part_mappings').insert(m)
        if (e2) console.error(`  Failed: ${m.internal_part_number} for customer ${m.customer_id}: ${e2.message}`)
        else inserted++
      }
    } else {
      inserted += batch.length
    }
  }

  console.log(`\n✅ Imported ${inserted} customer part mappings`)

  // Summary
  const { data: summary } = await supabase.from('customers').select('name')
  console.log('\nCustomers:')
  for (const c of summary) console.log(`  - ${c.name}`)
  
  const { count } = await supabase.from('customer_part_mappings').select('*', { count: 'exact', head: true })
  console.log(`\nTotal mappings in DB: ${count}`)
}

main().catch(e => { console.error(e); process.exit(1) })
