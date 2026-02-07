import { NextResponse } from 'next/server'
import { fetchBOM, GIDS } from '@/lib/google-sheets'

export async function GET() {
  try {
    const bom = await fetchBOM(GIDS.bomSub)
    return NextResponse.json(bom)
  } catch (error) {
    console.error('Failed to fetch sub-assembly BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sub-assembly BOM data' },
      { status: 500 }
    )
  }
}
