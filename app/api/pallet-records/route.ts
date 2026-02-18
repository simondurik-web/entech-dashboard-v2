import { NextResponse } from 'next/server'
import { fetchPalletRecords } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'

export async function GET() {
  try {
    const records = await fetchPalletRecords()
    const resolved = await resolveRecordPhotos(records, ['photos'])
    return NextResponse.json(resolved)
  } catch (error) {
    console.error('Failed to fetch pallet records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pallet records' },
      { status: 500 }
    )
  }
}
