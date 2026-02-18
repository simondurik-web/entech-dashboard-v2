import { NextResponse } from 'next/server'
import { fetchBOMSub } from '@/lib/google-sheets'

export async function GET() {
  try {
    const bom = await fetchBOMSub()
    return NextResponse.json(bom)
  } catch (error) {
    console.error('Failed to fetch sub-assembly BOM:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sub-assembly BOM data' },
      { status: 500 }
    )
  }
}
