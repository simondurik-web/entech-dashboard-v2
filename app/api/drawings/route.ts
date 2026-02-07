import { NextResponse } from 'next/server'
import { fetchDrawings } from '@/lib/google-sheets'

export async function GET() {
  try {
    const drawings = await fetchDrawings()
    return NextResponse.json(drawings)
  } catch (error) {
    console.error('Failed to fetch drawings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch drawings' },
      { status: 500 }
    )
  }
}
