import { NextResponse } from 'next/server'
import { fetchOrdersFromDB } from '@/lib/supabase-data'
import { fetchOrders } from '@/lib/google-sheets'

export async function GET() {
  try {
    // Primary: Supabase, Fallback: Google Sheets
    try {
      const orders = await fetchOrdersFromDB()
      return NextResponse.json(orders)
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      const orders = await fetchOrders()
      return NextResponse.json(orders)
    }
  } catch (error) {
    console.error('Failed to fetch orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}
