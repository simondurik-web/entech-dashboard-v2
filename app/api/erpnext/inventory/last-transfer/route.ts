import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/erpnext/inventory/last-transfer
// The most recent completed bulk transfer (destination bin, # pallets, who, when), so the
// Transfer screen can show a "last transfer" line. Read-only; pure Supabase.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_ops_log')
      .select('warehouse, qty, created_by, created_at')
      .eq('action', 'bulk-transfer')
      .in('status', ['done', 'erp_committed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ last: null }, { headers: { 'Cache-Control': 'no-store' } })

    let by = ''
    if (data.created_by) {
      const { data: prof } = await supabaseAdmin
        .from('user_profiles')
        .select('full_name, email')
        .eq('id', data.created_by)
        .maybeSingle()
      by = prof?.full_name || prof?.email || ''
    }
    return NextResponse.json(
      { last: { destination: data.warehouse, count: data.qty, by, at: data.created_at } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('last-transfer lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
