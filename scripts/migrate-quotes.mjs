/**
 * Migrate quotes from Google Sheets + Drive PDFs to Supabase.
 *
 * Usage:  node scripts/migrate-quotes.mjs
 *
 * Prerequisites:
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - ~/clawd/secrets/google-service-account.json with Drive read access
 *   - The `quotes` table must exist in Supabase (SQL provided below if not)
 */

import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Load .env.local ──
const envPath = path.join(__dirname, '..', '.env.local')
const envText = fs.readFileSync(envPath, 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Missing Supabase env vars')

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── Google Auth ──
const SA_PATH = path.join(__dirname, '..', '..', '..', 'secrets', 'google-service-account.json')
const creds = JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'))
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
})
const drive = google.drive({ version: 'v3', auth })

// ── Config ──
const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'
const GID = '1279128282'
const DRIVE_FOLDER = '18JMJa9wt3Z1G_29KiSTQBJLim_e_FE-p'
const BUCKET = 'quote-pdfs'

// ── Step 1: Create storage bucket ──
async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(BUCKET, { public: true })
  if (error && !error.message.includes('already exists')) {
    console.warn('Bucket creation warning:', error.message)
  }
  console.log('✅ Storage bucket ready')
}

// ── Step 2: Create table via SQL ──
async function ensureTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS quotes (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      quote_number text UNIQUE NOT NULL,
      customer text NOT NULL,
      created_date timestamptz,
      valid_until timestamptz,
      amount numeric(12,2) DEFAULT 0,
      sales_rep text,
      quoted_items integer DEFAULT 0,
      notes text,
      payment_terms text,
      extra_notes text,
      status text DEFAULT 'draft',
      pdf_url text,
      pdf_path text,
      drive_link text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
  `
  // Use Supabase REST SQL endpoint
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const txt = await res.text()
    console.warn('⚠️  Could not create table via RPC. You may need to create it manually in Supabase Dashboard.')
    console.warn('   Error:', txt)
    console.warn('   SQL to run:\n', sql)
    // Try inserting a test row to check if table exists
    const { error } = await supabase.from('quotes').select('id').limit(1)
    if (error) {
      console.error('❌ Table does not exist and could not be created. Please run the SQL above in Supabase Dashboard.')
      process.exit(1)
    }
    console.log('✅ Table already exists')
    return
  }
  console.log('✅ Table created/verified')
}

// ── Step 3: Fetch quotes from Google Sheets ──
async function fetchQuotes() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}`
  const res = await fetch(url)
  const text = await res.text()
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/)
  if (!match) throw new Error('Failed to parse sheet')
  const json = JSON.parse(match[1])
  const cols = json.table.cols
  const rows = json.table.rows

  let headers = cols.map((c, i) => c.label || `col${i}`)
  if (headers.every(h => h.startsWith('col')) && rows.length > 0) {
    headers = rows[0].c.map((cell, i) => cell?.v != null ? String(cell.v) : `col${i}`)
    rows.shift()
  }

  const quotes = rows.map(row => {
    const obj = {}
    headers.forEach((h, i) => {
      const cell = row.c?.[i]
      obj[h] = cell?.v != null ? cell.v : ''
    })
    return obj
  }).filter(q => q['Quote Number'])

  console.log(`✅ Fetched ${quotes.length} quotes from Google Sheets`)
  return quotes
}

// ── Step 4: List Drive PDFs ──
async function listDrivePDFs() {
  const pdfMap = new Map() // filename -> fileId
  let pageToken = undefined
  do {
    const res = await drive.files.list({
      q: `'${DRIVE_FOLDER}' in parents and mimeType='application/pdf' and trashed=false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: 100,
      pageToken,
    })
    for (const f of res.data.files || []) {
      pdfMap.set(f.name, f.id)
    }
    pageToken = res.data.nextPageToken
  } while (pageToken)
  console.log(`✅ Found ${pdfMap.size} PDFs in Drive`)
  return pdfMap
}

// ── Step 5: Download and upload a single PDF ──
async function migratePDF(fileId, fileName) {
  // Check if already uploaded
  const { data: existing } = await supabase.storage.from(BUCKET).list('', {
    search: fileName,
  })
  if (existing?.some(f => f.name === fileName)) {
    const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(fileName)}`
    return { url, path: fileName }
  }

  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
  const buffer = Buffer.from(res.data)

  const { error } = await supabase.storage.from(BUCKET).upload(fileName, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) {
    console.warn(`  ⚠️  Upload failed for ${fileName}: ${error.message}`)
    return null
  }
  const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(fileName)}`
  return { url, path: fileName }
}

// ── Helpers ──
function parseDate(v) {
  if (!v) return null
  if (typeof v === 'string' && v.startsWith('Date(')) {
    // Google Sheets Date(year,month,day) format (month is 0-based)
    const m = v.match(/Date\((\d+),(\d+),(\d+)/)
    if (m) return new Date(+m[1], +m[2], +m[3]).toISOString()
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function parseAmount(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[$,]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

function parseItems(v) {
  if (!v) return 0
  const n = parseInt(String(v))
  return isNaN(n) ? 0 : n
}

function matchPDF(quoteNumber, pdfMap) {
  // Try exact match first, then fuzzy
  for (const [name, id] of pdfMap) {
    const normalized = name.replace(/\.pdf$/i, '').replace(/[-_\s]/g, '').toLowerCase()
    const qn = String(quoteNumber).replace(/[-_\s]/g, '').toLowerCase()
    if (normalized.includes(qn) || qn.includes(normalized)) {
      return { name, id }
    }
  }
  return null
}

// ── Main ──
async function main() {
  console.log('🚀 Starting quotes migration...\n')

  await ensureBucket()
  await ensureTable()

  const quotes = await fetchQuotes()
  const pdfMap = await listDrivePDFs()

  let inserted = 0, skipped = 0, pdfCount = 0

  for (const q of quotes) {
    const quoteNumber = String(q['Quote Number']).trim()
    if (!quoteNumber) continue

    // Check if already exists
    const { data: existing } = await supabase
      .from('quotes')
      .select('id')
      .eq('quote_number', quoteNumber)
      .limit(1)
    if (existing?.length > 0) {
      skipped++
      continue
    }

    // Try to find and upload matching PDF
    let pdfResult = null
    const pdfMatch = matchPDF(quoteNumber, pdfMap)
    if (pdfMatch) {
      console.log(`  📄 Uploading PDF: ${pdfMatch.name}`)
      pdfResult = await migratePDF(pdfMatch.id, pdfMatch.name)
      if (pdfResult) pdfCount++
    }

    const record = {
      quote_number: quoteNumber,
      customer: String(q['Customer'] || '').trim(),
      created_date: parseDate(q['Created Date']),
      valid_until: parseDate(q['Valid until']),
      amount: parseAmount(q['Amount']),
      sales_rep: String(q['Sales Rep'] || '').trim() || null,
      quoted_items: parseItems(q['QUOTED ITEMS']),
      notes: String(q['Notes'] || '').trim() || null,
      payment_terms: String(q['Payment terms'] || '').trim() || null,
      extra_notes: String(q['Extra notes Phil'] || '').trim() || null,
      drive_link: String(q['Drive Link'] || '').trim() || null,
      pdf_url: pdfResult?.url || null,
      pdf_path: pdfResult?.path || null,
    }

    const { error } = await supabase.from('quotes').insert(record)
    if (error) {
      console.warn(`  ⚠️  Failed to insert ${quoteNumber}: ${error.message}`)
    } else {
      inserted++
    }
  }

  console.log(`\n✅ Migration complete!`)
  console.log(`   Inserted: ${inserted}`)
  console.log(`   Skipped (existing): ${skipped}`)
  console.log(`   PDFs uploaded: ${pdfCount}`)
}

main().catch(err => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
