import { NextResponse } from 'next/server'
import { fetchBOM, GIDS } from '@/lib/google-sheets'

export async function GET() {
  try {
    const bom = await fetchBOM(GIDS.bomIndividual)
    return NextResponse.json(bom)
  } catch (error) {
    console.error('Failed to fetch individual BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch individual BOM data' },
      { status: 500 }
    )
  }
}
