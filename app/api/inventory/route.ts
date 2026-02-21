import { NextResponse } from 'next/server'
import { fetchInventory } from '@/lib/google-sheets'

// 2026-02-21: Switched to Google Sheets primary (Supabase had stale data, no sync job)

export async function GET() {
  try {
    const items = await fetchInventory()
    return NextResponse.json(items)
  } catch (error) {
    console.error('Failed to fetch inventory:', error)
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
      { status: 500 }
    )
  }
}
