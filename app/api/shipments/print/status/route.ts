import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isRealDate } from '@/lib/shipments/et-date'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!(await requirePermission(req, 'shipments:print'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const date = req.nextUrl.searchParams.get('date')
  if (!isRealDate(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('print_jobs')
    .select('id,station_id,status,error,created_at,printed_at')
    .eq('item_code', 'SHIPMENT-DOC')
    .eq('batch', date)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('shipment print status lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }

  return NextResponse.json(
    { jobs: data ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
