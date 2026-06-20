import { NextRequest, NextResponse } from 'next/server'
import { locateItems } from '@/lib/erpnext/client'

// Search-by-location: GET /api/erpnext/locate?q=Trio%20A
// Returns matching items and every bin that holds them, live from ERPNext.
// Read-only; secrets stay server-side in lib/erpnext/client.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json({ results: [] })
  }
  try {
    const results = await locateItems(q)
    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' } }
    )
  } catch (error) {
    console.error('ERPNext locate failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
