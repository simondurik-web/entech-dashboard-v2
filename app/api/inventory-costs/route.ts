import { NextResponse } from 'next/server'
import { google } from 'googleapis'

const SHEET_ID = '1yASi9Ot4GLBw2iQLfODAvOFHBWrNE8qqYfzvUTjhrz8'
const TAB = 'Current inventory'

// Column indices (0-based)
const COL_FUSION_ID = 0      // A
const COL_DESCRIPTION = 1    // B
const COL_NETSUITE_ID = 2    // C
const COL_COST = 9           // J - Cost
const COL_LOWER_COST = 10    // K - Lower of Cost or Market
const COL_DEPARTMENT = 28    // AC
const COL_SUB_DEPARTMENT = 29 // AD

function parseCurrency(val: string | undefined | null): number | null {
  if (!val) return null
  const cleaned = String(val).replace(/[$,"\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function getAuth() {
  // Try base64 env var first (most reliable for Vercel)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_BASE64) {
    const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64, 'base64').toString())
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
  }

  // Try JSON env var (fallback)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    if (credentials.private_key) {
      credentials.private_key = credentials.private_key.replace(/\\n/g, '\n')
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
  }

  // Local dev fallback
  return new google.auth.GoogleAuth({
    keyFile: '/Users/simondurik/clawd/secrets/google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
}

export async function GET() {
  try {
    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${TAB}'!A:AD`,
    })

    const rows = res.data.values
    if (!rows || rows.length < 2) {
      return NextResponse.json({ costs: {}, debug: { rowCount: rows?.length ?? 0, hasEnv: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON } })
    }

    const costs: Record<string, {
      fusionId: string
      description: string
      netsuiteId: string
      cost: number | null
      lowerCost: number | null
      department: string
      subDepartment: string
    }> = {}

    // Skip header row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const fusionId = row[COL_FUSION_ID]?.trim()
      if (!fusionId) continue

      costs[fusionId] = {
        fusionId,
        description: row[COL_DESCRIPTION]?.trim() || '',
        netsuiteId: row[COL_NETSUITE_ID]?.trim() || '',
        cost: parseCurrency(row[COL_COST]),
        lowerCost: parseCurrency(row[COL_LOWER_COST]),
        department: row[COL_DEPARTMENT]?.trim() || '',
        subDepartment: row[COL_SUB_DEPARTMENT]?.trim() || '',
      }
    }

    return NextResponse.json(
      { costs },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Failed to fetch inventory costs:', msg)
    return NextResponse.json(
      { error: 'Failed to fetch inventory costs', detail: msg },
      { status: 500 }
    )
  }
}
