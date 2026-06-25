import { NextRequest, NextResponse } from 'next/server'
import { fetchStagedRecords } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
