import { NextResponse } from 'next/server'
import { fetchProductionMake } from '@/lib/google-sheets'

export async function GET() {
  try {
    const items = await fetchProductionMake()
    return NextResponse.json(items)
  } catch (error) {
    console.error('Failed to fetch production make data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch production data' },
      { status: 500 }
    )
  }
}
