import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireAdmin } from '@/lib/require-user'
import { isPrinterAdminRole } from '@/lib/erpnext/printer-access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DASHBOARD_APP_ID = 'dashboard'
const INVENTORY_OPS_PATH = '/inventory-ops'

// GET — the matrix data: active users (with effective role), all stations, and
// the current deny rows. Default-allow: a (user, station) cell is allowed unless
// it appears in `denied`. Admin-role users are always-all (the UI locks them).
export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('id, email, full_name, role, is_active')
    .order('email')
  const { data: appRoles } = await supabaseAdmin
    .from('user_app_roles')
    .select('user_id, role')
    .eq('app_id', DASHBOARD_APP_ID)
  const roleMap = new Map((appRoles ?? []).map((r) => [r.user_id, r.role]))

  // Only list users who can actually use inventory-ops / print labels — mirrors
  // requireInventoryAccess: admins, or a role whose menu_access grants
  // '/inventory-ops'. Keeps the matrix to people in the workflow (no clutter).
  const { data: rolePerms } = await supabaseAdmin
    .from('role_permissions')
    .select('role, menu_access')
  const invOpsRoles = new Set<string>()
  for (const rp of rolePerms ?? []) {
    const menu = (rp.menu_access ?? {}) as Record<string, boolean>
    if (menu[INVENTORY_OPS_PATH] === true) invOpsRoles.add(rp.role as string)
  }

  const users = (profiles ?? [])
    .filter((u) => u.is_active !== false)
    .map((u) => {
      // Use the dashboard app-role (fallback 'visitor'), matching how the label
      // routes resolve role for enforcement — so the matrix's "admin = all" lock
      // can't diverge from who actually bypasses the ACL server-side.
      const role = roleMap.get(u.id) ?? 'visitor'
      return { id: u.id, email: u.email, name: u.full_name ?? null, role, isAdmin: isPrinterAdminRole(role) }
    })
    .filter((u) => u.isAdmin || invOpsRoles.has(u.role))

  const { data: stations } = await supabaseAdmin
    .from('print_stations')
    .select('id, name, location, enabled')
    .order('name')
  const { data: denies } = await supabaseAdmin
    .from('user_printer_access')
    .select('user_id, station_id')
    .eq('allowed', false)
  const { data: defaults } = await supabaseAdmin
    .from('user_default_printer')
    .select('user_id, station_id')

  return NextResponse.json(
    { users, stations: stations ?? [], denied: denies ?? [], defaults: defaults ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// PUT — toggle one cell. allowed=true drops the deny row (back to default-allow);
// allowed=false writes a deny row. Admin-role users can't be restricted (they
// bypass the ACL in enforcement anyway).
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const raw = await req.json().catch(() => ({}))
  // Normalize to a plain object so the `'x' in body` checks below can't throw on
  // valid-but-non-object JSON (null / string / number / array) — would 500 otherwise.
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}

  // Set/clear a user's DEFAULT printer (distinct body shape from a cell toggle).
  if ('default_station_id' in body) {
    const { user_id, default_station_id } = body as { user_id?: string; default_station_id?: string | null }
    if (!user_id) return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
    if (!default_station_id) {
      const { error } = await supabaseAdmin.from('user_default_printer').delete().eq('user_id', user_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await supabaseAdmin.from('user_default_printer').upsert({
        user_id,
        station_id: default_station_id,
        updated_by: admin.id,
        updated_at: new Date().toISOString(),
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  const { user_id, station_id, allowed } = body as {
    user_id?: string
    station_id?: string
    allowed?: boolean
  }
  if (!user_id || !station_id || typeof allowed !== 'boolean') {
    return NextResponse.json({ error: 'user_id, station_id and allowed are required' }, { status: 400 })
  }

  if (allowed) {
    const { error } = await supabaseAdmin
      .from('user_printer_access')
      .delete()
      .eq('user_id', user_id)
      .eq('station_id', station_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabaseAdmin.from('user_printer_access').upsert({
      user_id,
      station_id,
      allowed: false,
      updated_by: admin.id,
      updated_at: new Date().toISOString(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Denying a station that was this user's default would leave a stale default
    // (masked at read time, but cleaner to drop it).
    await supabaseAdmin
      .from('user_default_printer')
      .delete()
      .eq('user_id', user_id)
      .eq('station_id', station_id)
  }

  return NextResponse.json({ ok: true })
}
