import { NextResponse } from 'next/server'
import { fetchOrders } from '@/lib/google-sheets'
import { supabaseAdmin } from '@/lib/supabase-admin'

// 2026-02-21: Google Sheets for order data + Supabase for priority overrides
// Priority overrides are stored only in Supabase (dashboard_orders table)

export async function GET() {
  try {
    const orders = await fetchOrders()

    // Merge priority overrides from Supabase
    try {
      const { data: priorities } = await supabaseAdmin
        .from('dashboard_orders')
        .select('line, priority_override, priority_changed_by, priority_changed_at')
        .not('priority_override', 'is', null)

      if (priorities && priorities.length > 0) {
        const priorityMap = new Map(
          priorities.map((p) => [String(p.line), p])
        )
        for (const order of orders) {
          const override = priorityMap.get(order.line)
          if (override) {
            order.priorityOverride = override.priority_override
            order.priorityChangedBy = override.priority_changed_by
            order.priorityChangedAt = override.priority_changed_at
          }
        }
      }
    } catch (dbErr) {
      console.warn('Could not fetch priority overrides from Supabase:', dbErr)
      // Non-fatal — orders still display, just without priority overrides
    }

    return NextResponse.json(orders)
  } catch (error) {
    console.error('Failed to fetch orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}
