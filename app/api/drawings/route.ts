import { NextResponse } from 'next/server'
import { fetchDrawingsFromDB } from '@/lib/supabase-data'
import { fetchDrawings } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'

export async function GET() {
  try {
    let drawings
    try {
      drawings = await fetchDrawingsFromDB()
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      drawings = await fetchDrawings()
    }
    const resolved = await resolveRecordPhotos(drawings, ['drawing1Url', 'drawing2Url'])
    return NextResponse.json(resolved)
  } catch (error) {
    console.error('Failed to fetch drawings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch drawings' },
      { status: 500 }
    )
  }
}
