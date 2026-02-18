import { NextResponse } from 'next/server'
import { fetchStagedRecords } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'

export async function GET() {
  try {
    const records = await fetchStagedRecords()
    const resolved = await resolveRecordPhotos(records, ['photos', 'fusionPhotos'])
    return NextResponse.json(resolved)
  } catch (error) {
    console.error('Failed to fetch staged records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch staged records' },
      { status: 500 }
    )
  }
}
