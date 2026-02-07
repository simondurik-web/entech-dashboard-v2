import { NextResponse } from 'next/server'
import { fetchInventory } from '@/lib/google-sheets'

export async function GET() {
  try {
    const items = await fetchInventory()
    return NextResponse.json(items)
  } catch (error) {
    console.error('Failed to fetch inventory:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory from Google Sheets' },
      { status: 500 }
    )
  }
}
