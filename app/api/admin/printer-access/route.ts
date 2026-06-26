import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/require-user'
import { isPrinterAdminRole } from '@/lib/erpnext/printer-access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'
const DASHBOARD_APP_ID = 'dashboard'

// Admin gate — mirrors app/api/admin/permissions (super-admin email OR the
// dashboard app-role 'admin'). Returns the admin's own user id for audit.
async function requireAdmin(req: NextRequest): Promise<string | null> {
  const userId = (await requireUser(req))?.id
  if (!userId) return null
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('email')
    .eq('id', userId)
    .single()
  if (profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL) return userId
  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', DASHBOARD_APP_ID)
    .maybeSingle()
  return appRole?.role === 'admin' ? userId : null
}

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

  const users = (profiles ?? [])
    .filter((u) => u.is_active !== false)
    .map((u) => {
      const role = roleMap.get(u.id) ?? u.role
      return { id: u.id, email: u.email, name: u.full_name ?? null, role, isAdmin: isPrinterAdminRole(role) }
    })

  const { data: stations } = await supabaseAdmin
    .from('print_stations')
    .select('id, name, location, enabled')
    .order('name')
  const { data: denies } = await supabaseAdmin
    .from('user_printer_access')
    .select('user_id, station_id')
    .eq('allowed', false)

  return NextResponse.json(
    { users, stations: stations ?? [], denied: denies ?? [] },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

// PUT — toggle one cell. allowed=true drops the deny row (back to default-allow);
// allowed=false writes a deny row. Admin-role users can't be restricted (they
// bypass the ACL in enforcement anyway).
export async function PUT(req: NextRequest) {
  const adminId = await requireAdmin(req)
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
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
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
