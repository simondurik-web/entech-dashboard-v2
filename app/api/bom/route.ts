import { NextResponse } from 'next/server'
import { fetchBOM } from '@/lib/google-sheets'

export async function GET() {
  try {
    const bom = await fetchBOM()
    return NextResponse.json(bom)
  } catch (error) {
    console.error('Failed to fetch BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch BOM data' },
      { status: 500 }
    )
  }
}
