import { NextResponse } from 'next/server'
import { fetchInventoryHistoryFromDB } from '@/lib/supabase-data'
import { fetchInventoryHistory } from '@/lib/google-sheets'

export async function GET() {
  try {
    let history
    try {
      // Primary: Supabase
      history = await fetchInventoryHistoryFromDB()
    } catch (dbError) {
      console.warn('Supabase inventory history failed, falling back to Google Sheets:', dbError)
      history = await fetchInventoryHistory()
    }
    return NextResponse.json(history)
  } catch (error) {
    console.error('Failed to fetch inventory history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory history' },
      { status: 500 }
    )
  }
}
