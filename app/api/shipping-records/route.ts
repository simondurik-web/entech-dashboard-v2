import { NextResponse } from 'next/server'
import { fetchShippingRecords } from '@/lib/google-sheets'

export async function GET() {
  try {
    const records = await fetchShippingRecords()
    return NextResponse.json(records)
  } catch (error) {
    console.error('Failed to fetch shipping records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping records' },
      { status: 500 }
    )
  }
}
