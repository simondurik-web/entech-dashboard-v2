import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const DASHBOARD_APP_ID = "dashboard"

async function getAppRole(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("app_id", DASHBOARD_APP_ID)
    .single()
  return data?.role || null
}

async function isAdmin(req: NextRequest): Promise<boolean> {
  const userId = req.headers.get("x-user-id")
  if (!userId) return false
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email")
    .eq("id", userId)
    .single()
  if (profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true
  const appRole = await getAppRole(userId)
  return appRole === "admin"
}

export async function GET(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: users, error } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get app-specific roles
  const { data: appRoles } = await supabaseAdmin
    .from("user_app_roles")
    .select("user_id, role")
    .eq("app_id", DASHBOARD_APP_ID)

  const roleMap = new Map((appRoles || []).map((r) => [r.user_id, r.role]))

  const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers()
  const authMap = new Map(authUsers?.map((u) => [u.id, u]) || [])

  const enriched = users?.map((u) => ({
    ...u,
    role: roleMap.get(u.id) || u.role, // app role takes priority
    last_login: authMap.get(u.id)?.last_sign_in_at || null,
  }))

  // Count users per app-specific role
  const roleCounts: Record<string, number> = {}
  for (const u of enriched ?? []) {
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1
  }

  return NextResponse.json({ users: enriched, roleCounts })
}

export async function PUT(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { user_id, role, custom_permissions, is_active } = body

  if (!user_id) return NextResponse.json({ error: "Missing user id" }, { status: 400 })

  const { data: targetUser } = await supabaseAdmin
    .from("user_profiles")
    .select("email")
    .eq("id", user_id)
    .single()
  if (targetUser?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    if (role !== undefined && role !== "admin") {
      return NextResponse.json({ error: "Cannot change super admin role" }, { status: 403 })
    }
    if (is_active === false) {
      return NextResponse.json({ error: "Cannot deactivate super admin" }, { status: 403 })
    }
  }

  // Write role to user_app_roles (app-specific)
  if (role !== undefined) {
    await supabaseAdmin
      .from("user_app_roles")
      .upsert(
        { user_id, app_id: DASHBOARD_APP_ID, role, updated_at: new Date().toISOString() },
        { onConflict: "user_id,app_id" }
      )
  }

  // Write non-role fields to user_profiles (shared)
  const profileUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (custom_permissions !== undefined) profileUpdates.custom_permissions = custom_permissions
  if (is_active !== undefined) profileUpdates.is_active = is_active

  if (Object.keys(profileUpdates).length > 1) {
    await supabaseAdmin.from("user_profiles").update(profileUpdates).eq("id", user_id)
  }

  // Return with app-specific role
  const { data: profile } = await supabaseAdmin.from("user_profiles").select("*").eq("id", user_id).single()
  const appRole = await getAppRole(user_id)

  return NextResponse.json({ user: { ...profile, role: appRole || profile?.role } })
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { email, role, full_name } = body

  if (!email || !role) {
    return NextResponse.json({ error: "Missing email or role" }, { status: 400 })
  }

  const { data: existing } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email")
    .ilike("email", email)
    .single()

  if (existing) {
    // Set app-specific role
    await supabaseAdmin
      .from("user_app_roles")
      .upsert(
        { user_id: existing.id, app_id: DASHBOARD_APP_ID, role, updated_at: new Date().toISOString() },
        { onConflict: "user_id,app_id" }
      )

    return NextResponse.json({ user: { ...existing, role } })
  }

  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name: full_name || '', pre_enrolled: true },
  })

  if (authError) {
    if (authError.message?.includes('already been registered') || authError.status === 422) {
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers()
      const found = authUsers?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
      if (found) {
        await supabaseAdmin
          .from("user_profiles")
          .upsert({ id: found.id, email, role: 'visitor', full_name: full_name || null, is_active: true }, { onConflict: 'id' })

        await supabaseAdmin
          .from("user_app_roles")
          .upsert(
            { user_id: found.id, app_id: DASHBOARD_APP_ID, role, updated_at: new Date().toISOString() },
            { onConflict: "user_id,app_id" }
          )

        const { data: profile } = await supabaseAdmin.from("user_profiles").select("*").eq("id", found.id).single()
        return NextResponse.json({ user: { ...profile, role } })
      }
    }
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .insert({ id: authUser.user.id, email, role: 'visitor', full_name: full_name || null, is_active: true })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin
    .from("user_app_roles")
    .upsert(
      { user_id: authUser.user.id, app_id: DASHBOARD_APP_ID, role, updated_at: new Date().toISOString() },
      { onConflict: "user_id,app_id" }
    )

  return NextResponse.json({ user: { ...profile, role } })
}
