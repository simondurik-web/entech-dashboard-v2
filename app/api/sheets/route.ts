import { NextResponse } from 'next/server'
import { fetchOrders } from '@/lib/google-sheets'

// 2026-02-21: Switched back to Google Sheets as primary data source.
// Supabase dashboard_orders table had stale data (no sync job was ever built).
// TODO: Build a proper Sheets→Supabase sync job before re-enabling DB reads.

export async function GET() {
  try {
    const orders = await fetchOrders()
    return NextResponse.json(orders)
  } catch (error) {
    console.error('Failed to fetch orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}
