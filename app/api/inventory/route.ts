import { NextResponse } from 'next/server'
import { fetchInventoryFromDB } from '@/lib/supabase-data'
import { fetchInventory } from '@/lib/google-sheets'

export async function GET() {
  try {
    try {
      const items = await fetchInventoryFromDB()
      return NextResponse.json(items)
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      const items = await fetchInventory()
      return NextResponse.json(items)
    }
  } catch (error) {
    console.error('Failed to fetch inventory:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
      { status: 500 }
    )
  }
}
