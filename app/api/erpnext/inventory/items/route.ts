import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { searchItems, listAllItems } from '@/lib/erpnext/client'

// GET /api/erpnext/inventory/items?q=    -> item picker for the Add form (code/name search).
// GET /api/erpnext/inventory/items?all=1 -> every stockable part (the By-item dropdown).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  try {
    if (req.nextUrl.searchParams.get('all') === '1') {
      const items = await listAllItems()
      return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
    if (q.length < 2) return NextResponse.json({ items: [] })
    const items = await searchItems(q)
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('search items failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
