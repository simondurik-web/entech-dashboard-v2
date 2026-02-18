import { NextResponse } from 'next/server'
import { fetchShippingRecords } from '@/lib/google-sheets'
import { resolveRecordPhotos } from '@/lib/photo-resolver'

export async function GET() {
  try {
    const records = await fetchShippingRecords()
    const resolved = await resolveRecordPhotos(records, [
      'photos',
      'shipmentPhotos',
      'paperworkPhotos',
      'closeUpPhotos',
    ])
    return NextResponse.json(resolved)
  } catch (error) {
    console.error('Failed to fetch shipping records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping records' },
      { status: 500 }
    )
  }
}
