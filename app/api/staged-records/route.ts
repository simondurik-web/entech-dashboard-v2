import { NextResponse } from 'next/server'
import { fetchStagedRecords } from '@/lib/google-sheets'

export async function GET() {
  try {
    const records = await fetchStagedRecords()
    return NextResponse.json(records)
  } catch (error) {
    console.error('Failed to fetch staged records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch staged records' },
      { status: 500 }
    )
  }
}
