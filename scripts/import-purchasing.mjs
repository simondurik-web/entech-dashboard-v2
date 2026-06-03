// One-time import of the "Purchasing Sheet" → purchasing_orders.
// Reads the 'all data Combined' tab with UNFORMATTED_VALUE (numbers, booleans,
// date serials), parses, and batch-inserts. Re-runnable: truncates first.
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

// load .env.local
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) process.env[m[1].trim()] = m[2].trim()
}

const key = JSON.parse(fs.readFileSync('/Users/simondurik/clawd/secrets/google-service-account.json', 'utf8'))
const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })
const spreadsheetId = '1NhuUY7MpEvyJZxLZJAMWx_tfnfnOEhIGLgj3VAx7iWI'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Excel/Sheets date serial -> ISO yyyy-mm-dd
function serialToISO(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null
  const ms = Math.round((n - 25569) * 86400000) // 25569 = days between 1899-12-30 and 1970-01-01
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}
function parseDate(v) {
  if (v === '' || v === null || v === undefined) return null
  if (typeof v === 'number') return serialToISO(v)
  const s = String(v).trim()
  if (!s) return null
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/) // M/D/YYYY
  if (m) {
    let [, mo, da, yr] = m
    yr = yr.length === 2 ? '20' + yr : yr
    const d = new Date(Date.UTC(+yr, +mo - 1, +da))
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}
function num(v) {
  if (v === '' || v === null || v === undefined) return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}
function bool(v) {
  if (typeof v === 'boolean') return v
  return String(v).trim().toUpperCase() === 'TRUE'
}
function txt(v) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/^\t+/, '').trim()
  return s === '' ? null : s
}

const res = await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: "'all data Combined'!A2:AA9305",
  valueRenderOption: 'UNFORMATTED_VALUE',
  dateTimeRenderOption: 'SERIAL_NUMBER',
})
const raw = res.data.values || []
const rows = []
raw.forEach((r, idx) => {
  if (!r[0] || String(r[0]).trim() === '') return // skip rows with no item description
  rows.push({
    legacy_row: idx + 2,
    item_description: txt(r[0]),
    external_number: txt(r[1]),
    // r[2] order_status — derived, not stored
    quantity: num(r[3]),
    total_cost: num(r[4]),
    // r[5] cost_per_unit — derived
    delivery_cost: num(r[6]),
    canceled: bool(r[7]),
    refunded: bool(r[8]),
    urgent: bool(r[9]),
    partial_delivery: bool(r[10]),
    requestor: txt(r[11]),
    deliver_to: txt(r[12]),
    sub_department: txt(r[13]),
    department: txt(r[14]),
    store: txt(r[15]),
    supplier_link: txt(r[16]),
    date_requested: parseDate(r[17]),
    date_ordered: parseDate(r[18]),
    promised_date: parseDate(r[19]),
    // r[20] days_until — derived
    received_date: parseDate(r[21]),
    received_by: txt(r[22]),
    poe_cc: txt(r[23]),
    notes: txt(r[24]),
    packing_slip_pic: txt(r[25]),
    item_pic: txt(r[26]),
  })
})
console.log('Parsed rows:', rows.length)

// Truncate (re-runnable)
const del = await supabase.from('purchasing_orders').delete().not('id', 'is', null)
if (del.error) { console.error('truncate error', del.error); process.exit(1) }

let inserted = 0
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500)
  const { error } = await supabase.from('purchasing_orders').insert(batch)
  if (error) { console.error('insert error at', i, error); process.exit(1) }
  inserted += batch.length
  console.log('inserted', inserted, '/', rows.length)
}
const { count } = await supabase.from('purchasing_orders').select('*', { count: 'exact', head: true })
console.log('DONE. table count =', count)
