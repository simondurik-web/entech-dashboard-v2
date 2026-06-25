import { NextRequest, NextResponse } from 'next/server'
import { fetchDrawingsFromDB } from '@/lib/supabase-data'
import { fetchDrawings } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    let drawings
    try {
      drawings = await fetchDrawingsFromDB()
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      drawings = await fetchDrawings()
    }
    const resolved = await resolveRecordPhotos(drawings, ['drawingUrls'])
    return NextResponse.json(resolved)
  } catch (error) {
    console.error('Failed to fetch drawings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch drawings' },
      { status: 500 }
    )
  }
}
