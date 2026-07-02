import { NextRequest, NextResponse } from 'next/server'
import { fetchArchivedOrders } from '@/lib/supabase-data'
import { requireReadAccess } from '@/lib/require-user'

// Read-only pre-ERPNext order history (dashboard_orders_fusion_archive). Loaded by
// the Orders Data page in the background and merged into the table only when the
// user searches, so old orders show alongside current ones without inflating the
// active counts. Same auth gate as /api/sheets.
export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const orders = await fetchArchivedOrders()
    return NextResponse.json(orders)
  } catch (error) {
    console.error('Failed to fetch archived orders:', error)
    return NextResponse.json({ error: 'Failed to fetch archived orders' }, { status: 500 })
  }
}
