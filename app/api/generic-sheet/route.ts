import { NextResponse } from 'next/server'
import { fetchSheetData, GIDS } from '@/lib/google-sheets'

type GIDKey = keyof typeof GIDS

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gidKey = searchParams.get('gid') as GIDKey
  
  if (!gidKey || !(gidKey in GIDS)) {
    return NextResponse.json({ error: 'Invalid or missing gid parameter' }, { status: 400 })
  }
  
  const gid = GIDS[gidKey]

  try {
    const { cols, rows } = await fetchSheetData(gid)
    
    // Use cols as headers
    const headers = cols.map((c, i) => c || `col${i}`)
    
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
