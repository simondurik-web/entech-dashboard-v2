import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { allowedStationIds, defaultStationForUser } from '@/lib/erpnext/printer-access'

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
  // Per-user ACL (default-deny): show only stations this user is explicitly
  // granted (admins see all).
  const allowed = await allowedStationIds(guard.userId, guard.role)
  const stations = allowed === 'all' ? (data ?? []) : (data ?? []).filter((s) => allowed.has(s.id))
  // The caller's default station — only echoed if it's actually in their allowed
  // list, so the UI never pre-selects a printer they can't use.
  const def = await defaultStationForUser(guard.userId)
  const defaultStationId = def && stations.some((s) => s.id === def) ? def : null
  return NextResponse.json({ stations, defaultStationId }, { headers: { 'Cache-Control': 'no-store' } })
}
