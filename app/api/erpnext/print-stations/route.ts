import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deniedStationIds, defaultStationForUser } from '@/lib/erpnext/printer-access'

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
  // Per-user ACL: hide stations this user is restricted from (admins see all).
  const denied = await deniedStationIds(guard.userId, guard.role)
  const stations = (data ?? []).filter((s) => !denied.has(s.id))
  // The caller's default station — only echoed if it's actually in their allowed
  // list, so the UI never pre-selects a printer they can't use.
  const def = await defaultStationForUser(guard.userId)
  const defaultStationId = def && stations.some((s) => s.id === def) ? def : null
  return NextResponse.json({ stations, defaultStationId }, { headers: { 'Cache-Control': 'no-store' } })
}
