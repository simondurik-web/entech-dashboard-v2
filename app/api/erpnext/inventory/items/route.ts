import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { searchItems } from '@/lib/erpnext/client'

// GET /api/erpnext/inventory/items?q=  -> item picker for the Add form.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ items: [] })
  try {
    const items = await searchItems(q)
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('search items failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
