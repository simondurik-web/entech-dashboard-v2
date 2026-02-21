import { NextResponse } from 'next/server'
import { fetchProductionMakeFromDB } from '@/lib/supabase-data'
import { fetchProductionMake } from '@/lib/google-sheets'

export async function GET() {
  try {
    try {
      const items = await fetchProductionMakeFromDB()
      return NextResponse.json(items)
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      const items = await fetchProductionMake()
      return NextResponse.json(items)
    }
  } catch (error) {
    console.error('Failed to fetch production make data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch production data' },
      { status: 500 }
    )
  }
}
