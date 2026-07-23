import { NextRequest, NextResponse } from 'next/server'
import { requirePermissionOrDevice } from '@/lib/require-user'
import { rpcAllRows } from '@/lib/shipments/rpc'
import { todayET } from '@/lib/shipments/et-date'
import { summarize } from '@/lib/shipments/rollup'
import type { DailyOrdersRow, DailyRollupRow } from '@/lib/shipments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!(await requirePermissionOrDevice(req, '/shipments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const today = todayET()
  const range = { p_from: addDays(today, -27), p_to: today }
  const [rollup, orders] = await Promise.all([
    rpcAllRows<DailyRollupRow>('shipment_daily_rollup', range, ['day', 'source_system', 'part_number', 'service']),
    rpcAllRows<DailyOrdersRow>('shipment_daily_orders', range, ['day', 'source_system']),
  ])

  if (rollup.error || orders.error) {
    console.error('shipments summary lookup failed:', rollup.error ?? orders.error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }

  return NextResponse.json(
    summarize(rollup.data ?? [], orders.data ?? [], today),
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
