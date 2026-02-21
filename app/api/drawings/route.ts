import { NextResponse } from 'next/server'
import { fetchDrawings } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'

// 2026-02-21: Switched to Google Sheets primary (Supabase had stale data, no sync job)

export async function GET() {
  try {
    const drawings = await fetchDrawings()
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
