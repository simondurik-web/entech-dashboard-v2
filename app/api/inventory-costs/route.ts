import { NextResponse } from 'next/server'
import { fetchInventoryCostsFromDB } from '@/lib/supabase-data'
import { google } from 'googleapis'

// Google Sheets fallback config
const SHEET_ID = '1yASi9Ot4GLBw2iQLfODAvOFHBWrNE8qqYfzvUTjhrz8'
const TAB = 'Current inventory export'

function parseCurrency(val: string | undefined | null): number | null {
  if (!val) return null
  const cleaned = String(val).replace(/[$,"\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function findCol(headers: string[], ...patterns: string[]): number {
  for (const pat of patterns) {
    const lp = pat.toLowerCase()
    const idx = headers.findIndex(h => h.toLowerCase().trim() === lp)
    if (idx >= 0) return idx
  }
  for (const pat of patterns) {
    const lp = pat.toLowerCase()
    const idx = headers.findIndex(h => h.toLowerCase().trim().includes(lp))
    if (idx >= 0) return idx
  }
  return -1
}

function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString())
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    if (credentials.private_key) credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
    return new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
  }
  return new google.auth.GoogleAuth({
    keyFile: '/Users/simondurik/clawd/secrets/google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
}

async function fetchCostsFromSheets(): Promise<Record<string, {
  fusionId: string; description: string; netsuiteId: string
  cost: number | null; lowerCost: number | null; department: string; subDepartment: string
}>> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `'${TAB}'` })
  const rows = res.data.values
  if (!rows || rows.length < 2) return {}

  const headers = rows[0].map((h: string) => String(h || ''))
  const COL_FUSION_ID = findCol(headers, 'fusion id')
  const COL_DESCRIPTION = findCol(headers, 'description')
  const COL_NETSUITE_ID = findCol(headers, 'netsuite item id')
  const COL_COST = findCol(headers, 'cost')
  const COL_LOWER_COST = findCol(headers, 'lower of cost or market')
  const COL_DEPARTMENT = findCol(headers, 'department')
  const COL_SUB_DEPARTMENT = findCol(headers, 'sub department')
  if (COL_FUSION_ID < 0) return {}

  const costs: Record<string, { fusionId: string; description: string; netsuiteId: string; cost: number | null; lowerCost: number | null; department: string; subDepartment: string }> = {}
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const fusionId = row[COL_FUSION_ID]?.trim()
    if (!fusionId) continue
    costs[fusionId] = {
      fusionId,
      description: COL_DESCRIPTION >= 0 ? (row[COL_DESCRIPTION]?.trim() || '') : '',
      netsuiteId: COL_NETSUITE_ID >= 0 ? (row[COL_NETSUITE_ID]?.trim() || '') : '',
      cost: COL_COST >= 0 ? parseCurrency(row[COL_COST]) : null,
      lowerCost: COL_LOWER_COST >= 0 ? parseCurrency(row[COL_LOWER_COST]) : null,
      department: COL_DEPARTMENT >= 0 ? (row[COL_DEPARTMENT]?.trim() || '') : '',
      subDepartment: COL_SUB_DEPARTMENT >= 0 ? (row[COL_SUB_DEPARTMENT]?.trim() || '') : '',
    }
  }
  return costs
}

export async function GET() {
  try {
    let costs
    try {
      // Primary: Supabase
      costs = await fetchInventoryCostsFromDB()
    } catch (dbError) {
      console.warn('Supabase inventory costs failed, falling back to Google Sheets:', dbError)
      costs = await fetchCostsFromSheets()
    }
    return NextResponse.json(
      { costs },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Failed to fetch inventory costs:', msg)
    return NextResponse.json({ error: 'Failed to fetch inventory costs', detail: msg }, { status: 500 })
  }
}
