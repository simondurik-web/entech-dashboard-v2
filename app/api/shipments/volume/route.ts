import { NextRequest, NextResponse } from 'next/server'
import { requirePermissionOrDevice } from '@/lib/require-user'
import { rpcAllRows } from '@/lib/shipments/rpc'
import { isRealDate } from '@/lib/shipments/et-date'
import { bucketize, topPartsWithOther } from '@/lib/shipments/rollup'
import type { DailyOrdersRow, DailyRollupRow, ShipmentTotals, VolumeBucketSize } from '@/lib/shipments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BUCKETS = new Set<VolumeBucketSize>(['day', 'week', 'month', 'quarter', 'year'])
const DAY_MS = 24 * 60 * 60 * 1000

function spanInDays(from: string, to: string): number {
  return Math.floor(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS
  )
}

export async function GET(req: NextRequest) {
  if (!(await requirePermissionOrDevice(req, '/shipments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  const requestedBucket = req.nextUrl.searchParams.get('bucket')
  if (
    !isRealDate(from) ||
    !isRealDate(to) ||
    from > to ||
    spanInDays(from, to) > 1100 ||
    !requestedBucket ||
    !BUCKETS.has(requestedBucket as VolumeBucketSize)
  ) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  const bucket = requestedBucket as VolumeBucketSize
  const range = { p_from: from, p_to: to }
  const [rollup, orders] = await Promise.all([
    rpcAllRows<DailyRollupRow>('shipment_daily_rollup', range, ['day', 'source_system', 'part_number', 'service']),
    rpcAllRows<DailyOrdersRow>('shipment_daily_orders', range, ['day', 'source_system']),
  ])
  if (rollup.error || orders.error) {
    console.error('shipments volume lookup failed:', rollup.error ?? orders.error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }

  const bucketed = bucketize(rollup.data ?? [], bucket, orders.data ?? [], { from, to })
  const { buckets, parts } = topPartsWithOther(bucketed)
  const totals = buckets.reduce<ShipmentTotals>(
    (sum, row) => ({
      units: sum.units + Number(row.units),
      lines: sum.lines + Number(row.lines),
      orders: sum.orders + Number(row.orders),
    }),
    { units: 0, lines: 0, orders: 0 }
  )

  return NextResponse.json(
    { buckets, parts, totals },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
