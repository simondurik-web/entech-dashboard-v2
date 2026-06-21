import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/erpnext/print-stations -> enabled print stations for the printer dropdown.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const { data, error } = await supabaseAdmin
    .from('print_stations')
    .select('id, name, location')
    .eq('enabled', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('list print stations failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
  return NextResponse.json({ stations: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}
