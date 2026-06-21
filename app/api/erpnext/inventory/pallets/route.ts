import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { listPallets } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/pallets?itemCode=  -> on-hand pallets for an item.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const itemCode = req.nextUrl.searchParams.get('itemCode')?.trim() ?? ''
  if (!itemCode) return NextResponse.json({ pallets: [] })
  try {
    const pallets = await listPallets(itemCode)
    return NextResponse.json({ pallets }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('list pallets failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
