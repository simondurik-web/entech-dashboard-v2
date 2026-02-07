import { NextResponse } from 'next/server'
import { fetchOrders } from '@/lib/google-sheets'

export async function GET() {
  try {
    const orders = await fetchOrders()
    return NextResponse.json(orders)
  } catch (error) {
    console.error('Failed to fetch orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders from Google Sheets' },
      { status: 500 }
    )
  }
}
