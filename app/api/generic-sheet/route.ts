import { NextResponse } from 'next/server'
import { GIDS } from '@/lib/google-sheets'

const SHEET_ID = '1bK0Ne-vX3i5wGoqyAklnyFDUNdE-WaN4Xs5XjggBSXw'

type GIDKey = keyof typeof GIDS

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gidKey = searchParams.get('gid') as GIDKey
  
  if (!gidKey || !(gidKey in GIDS)) {
    return NextResponse.json({ error: 'Invalid or missing gid parameter' }, { status: 400 })
  }
  
  const gid = GIDS[gidKey]
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`

  try {
    const res = await fetch(url, { next: { revalidate: 60 } })
    const text = await res.text()
    
    // Parse Google Sheets JSON response
    const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/)
    if (!match) {
      console.error('Failed to parse response:', text.slice(0, 200))
      return NextResponse.json({ error: 'Failed to parse sheet data' }, { status: 500 })
    }
    
    const json = JSON.parse(match[1])
    const cols = json.table.cols as { label: string }[]
    const rows = json.table.rows as { c: ({ v: unknown } | null)[] }[]
    
    // Extract headers from first row if cols don't have labels
    let headers = cols.map((c, i) => c.label || `col${i}`)
    
    // If all headers are empty, use first row as headers
    if (headers.every(h => h.startsWith('col'))) {
      if (rows.length > 0) {
        headers = rows[0].c.map((cell, i) => {
          const val = cell?.v
          return val != null ? String(val) : `col${i}`
        })
        rows.shift() // Remove header row from data
      }
    }
    
    // Convert rows to objects
    const data = rows.map((row) => {
      const obj: Record<string, unknown> = {}
      row.c.forEach((cell, i) => {
        const key = headers[i] || `col${i}`
        obj[key] = cell?.v ?? ''
      })
      return obj
    })
    
    return NextResponse.json({ headers, data })
  } catch (err) {
    console.error('Error fetching sheet:', err)
    return NextResponse.json({ error: 'Failed to fetch sheet data' }, { status: 500 })
  }
}
