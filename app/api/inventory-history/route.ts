import { NextResponse } from 'next/server'
import { fetchInventoryHistory } from '@/lib/google-sheets'

export async function GET() {
  try {
    const history = await fetchInventoryHistory()
    return NextResponse.json(history)
  } catch (error) {
    console.error('Failed to fetch inventory history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory history from Google Sheets' },
      { status: 500 }
    )
  }
}
