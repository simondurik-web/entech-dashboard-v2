import { NextRequest, NextResponse } from 'next/server'
import { fetchInventoryFromDB } from '@/lib/supabase-data'
import { fetchInventory } from '@/lib/google-sheets'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    try {
      const items = await fetchInventoryFromDB()
      return NextResponse.json(items, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      const items = await fetchInventory()
      return NextResponse.json(items, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }
  } catch (error) {
    console.error('Failed to fetch inventory:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
      { status: 500 }
    )
  }
}
