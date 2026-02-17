import { NextResponse } from 'next/server'
import { fetchDrawingsFromDB } from '@/lib/supabase-data'
import { fetchDrawings } from '@/lib/google-sheets'

export async function GET() {
  try {
    try {
      const drawings = await fetchDrawingsFromDB()
      return NextResponse.json(drawings)
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      const drawings = await fetchDrawings()
      return NextResponse.json(drawings)
    }
  } catch (error) {
    console.error('Failed to fetch drawings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch drawings' },
      { status: 500 }
    )
  }
}
