import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProfileFromHeader, unauthorized, forbidden } from '../_utils'
import { google } from 'googleapis'

const SHEET_ID = '1SqQeBkgzQPUqdMcOR-gIlPRk85renzqnV1bgn2C10lg'

async function getAuth() {
  const base64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64
  if (!base64) throw new Error('GOOGLE_SERVICE_ACCOUNT_BASE64 not set')
  const creds = JSON.parse(Buffer.from(base64, 'base64').toString())
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return auth
}

export async function POST(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile) return unauthorized()
  if (profile.role !== 'admin') return forbidden()

  try {
    const auth = await getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    // 1. Migrate employees from "Employee Reference data" tab
    const empRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Employee Reference data!A1:H100',
    })
    const empRows = empRes.data.values || []
    const employees = empRows.slice(1) // skip header
      .filter(row => row[0] && row[1]) // need ID and first name
      .map(row => ({
        employee_id: String(row[0]).trim(),
        first_name: String(row[1] || '').trim(),
        last_name: String(row[2] || '').trim(),
        pay_rate: row[3] ? parseFloat(String(row[3]).replace('$', '').replace(',', '')) || null : null,
        department: String(row[4] || 'Molding').trim(),
        default_shift: parseInt(String(row[5] || '1')) || 1,
        shift_length: parseFloat(String(row[6] || '10')) || 10,
        is_active: String(row[7] || 'TRUE').toUpperCase() === 'TRUE',
      }))

    if (employees.length > 0) {
      const { error: empError } = await supabaseAdmin
        .from('scheduling_employees')
        .upsert(employees, { onConflict: 'employee_id' })
      if (empError) throw new Error(`Employee upsert failed: ${empError.message}`)
    }

    // 2. Migrate historical schedule data from "Long Data" tab
    const longRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Long Data!A1:K20000',
    })
    const longRows = longRes.data.values || []
    const entries = longRows.slice(1) // skip header
      .filter(row => row[0] && row[5] && row[6] === '1') // need ID, date, and checked=1
      .map(row => {
        const shift = parseInt(String(row[4] || '1')) || 1
        const hours = parseFloat(String(row[10] || '10')) || 10
        // Calculate times from shift + hours
        let start_time = '07:00'
        let end_time = '17:30'
        if (shift === 2) {
          start_time = '17:30'
          end_time = '04:30'
        }

        // Parse date (MM/DD/YYYY format from Sheets)
        const rawDate = String(row[5])
        let date = rawDate
        const parts = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
        if (parts) {
          date = `${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
        }

        return {
          employee_id: String(row[0]).trim(),
          date,
          shift: shift > 2 ? 1 : shift, // normalize weird shift values (111, 222) to 1
          start_time,
          end_time,
        }
      })

    // Batch upsert in chunks of 500
    const CHUNK_SIZE = 500
    let inserted = 0
    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE)
      const { error: entryError } = await supabaseAdmin
        .from('scheduling_entries')
        .upsert(chunk, { onConflict: 'employee_id,date', ignoreDuplicates: true })
      if (entryError) {
        console.error(`Chunk ${i} error:`, entryError.message)
      } else {
        inserted += chunk.length
      }
    }

    return NextResponse.json({
      success: true,
      employees_migrated: employees.length,
      entries_migrated: inserted,
      total_long_data_rows: longRows.length - 1,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Migration failed'
    console.error('Migration error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
