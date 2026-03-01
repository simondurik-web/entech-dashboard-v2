import { NextResponse } from 'next/server'
import { google } from 'googleapis'

const SHEET_ID = '1yASi9Ot4GLBw2iQLfODAvOFHBWrNE8qqYfzvUTjhrz8'
const TAB = 'Current inventory export'

// Dynamic column lookup from header row — survives column additions
function findCol(headers: string[], ...patterns: string[]): number {
  for (const pat of patterns) {
    const lp = pat.toLowerCase()
    const idx = headers.findIndex(h => h.toLowerCase().trim() === lp)
    if (idx >= 0) return idx
  }
  // Partial match fallback
  for (const pat of patterns) {
    const lp = pat.toLowerCase()
    const idx = headers.findIndex(h => h.toLowerCase().trim().includes(lp))
    if (idx >= 0) return idx
  }
  return -1
}

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
      range: `'${TAB}'`,  // Fetch all columns — no hardcoded range limit
    })

    const rows = res.data.values
    if (!rows || rows.length < 2) {
      return NextResponse.json({ costs: {}, debug: { rowCount: rows?.length ?? 0, hasEnv: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON } })
    }

    // Dynamic column lookup from header row
    const headers = rows[0].map((h: string) => String(h || ''))
    const COL_FUSION_ID = findCol(headers, 'fusion id')
    const COL_DESCRIPTION = findCol(headers, 'description')
    const COL_NETSUITE_ID = findCol(headers, 'netsuite item id')
    const COL_COST = findCol(headers, 'cost')
    const COL_LOWER_COST = findCol(headers, 'lower of cost or market')
    const COL_DEPARTMENT = findCol(headers, 'department')
    const COL_SUB_DEPARTMENT = findCol(headers, 'sub department')

    if (COL_FUSION_ID < 0) {
      return NextResponse.json({ error: 'Could not find Fusion ID column in header', headers: headers.slice(0, 10) }, { status: 500 })
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
        description: COL_DESCRIPTION >= 0 ? (row[COL_DESCRIPTION]?.trim() || '') : '',
        netsuiteId: COL_NETSUITE_ID >= 0 ? (row[COL_NETSUITE_ID]?.trim() || '') : '',
        cost: COL_COST >= 0 ? parseCurrency(row[COL_COST]) : null,
        lowerCost: COL_LOWER_COST >= 0 ? parseCurrency(row[COL_LOWER_COST]) : null,
        department: COL_DEPARTMENT >= 0 ? (row[COL_DEPARTMENT]?.trim() || '') : '',
        subDepartment: COL_SUB_DEPARTMENT >= 0 ? (row[COL_SUB_DEPARTMENT]?.trim() || '') : '',
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
