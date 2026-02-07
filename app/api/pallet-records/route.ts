import { NextResponse } from 'next/server'
import { fetchPalletRecords } from '@/lib/google-sheets'

export async function GET() {
  try {
    const records = await fetchPalletRecords()
    return NextResponse.json(records)
  } catch (error) {
    console.error('Failed to fetch pallet records:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pallet records' },
      { status: 500 }
    )
  }
}
