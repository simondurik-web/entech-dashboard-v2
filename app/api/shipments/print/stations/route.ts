import { NextRequest, NextResponse } from 'next/server'
import { loadDashboardProfile, requirePermissionOrDevice } from '@/lib/require-user'
import { allowedStationIds } from '@/lib/erpnext/printer-access'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Stations that can print shipment deliverables: enabled, letter printer
// attached, and the user may print to them. requirePermission keeps per-user
// custom_permissions working (client canAccessExact matches it); the extra
// loadDashboardProfile call supplies the ROLE the station ACL needs.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const actor = await requirePermissionOrDevice(req, 'shipments:print')
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const role = actor.kind === 'device' ? (actor.role ?? '') : (await loadDashboardProfile(actor.id)).role

  const { data, error } = await supabaseAdmin
    .from('print_stations')
    .select('id, name, letter_printer')
    .eq('enabled', true)
    .not('letter_printer', 'is', null)
    .order('name')
  if (error) return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })

  const allowed = await allowedStationIds(actor.id, role)
  const stations = (data ?? [])
    .filter((s) => allowed === 'all' || allowed.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }))
  return NextResponse.json({ stations }, { headers: { 'Cache-Control': 'no-store' } })
}
