import { NextRequest, NextResponse } from 'next/server'
import { fetchOrdersFromDB } from '@/lib/supabase-data'
import { fetchOrders } from '@/lib/google-sheets'
import { fetchPriorityOverrides, mergePriorityOverrides } from '@/lib/priority-overrides'
import { applyAutoAssignRules } from '@/lib/auto-assign'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    // Fetch priority overrides (separate table, survives sync cycles)
    const overrides = await fetchPriorityOverrides()

    // Primary: Supabase, Fallback: Google Sheets
    try {
      const orders = await fetchOrdersFromDB()
      mergePriorityOverrides(orders, overrides)
      // Auto-assign unassigned orders based on customer rules. Awaited so the
      // response reflects the assignment on THIS load and the DB write reliably
      // completes (serverless can freeze after the response returns). Never let
      // an auto-assign failure break the orders response.
      try {
        await applyAutoAssignRules(orders)
      } catch (err) {
        console.warn('Auto-assign error:', err)
      }
      return NextResponse.json(orders)
    } catch (dbError) {
      console.warn('Supabase failed, falling back to Google Sheets:', dbError)
      const orders = await fetchOrders()
      mergePriorityOverrides(orders, overrides)
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
