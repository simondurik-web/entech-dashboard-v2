import { NextRequest, NextResponse } from 'next/server'
import { fetchInventoryHistoryFromDB } from '@/lib/supabase-data'
import { fetchInventoryHistory } from '@/lib/google-sheets'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    let history
    try {
      // Primary: Supabase
      history = await fetchInventoryHistoryFromDB()
    } catch (dbError) {
      console.warn('Supabase inventory history failed, falling back to Google Sheets:', dbError)
      history = await fetchInventoryHistory()
    }
    return NextResponse.json(history, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    console.error('Failed to fetch inventory history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory history' },
      { status: 500 }
    )
  }
}
