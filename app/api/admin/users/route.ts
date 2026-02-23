import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

// Hardcoded super admin — cannot be demoted
const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"

async function isAdmin(req: NextRequest): Promise<boolean> {
  const userId = req.headers.get("x-user-id")
  if (!userId) return false
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role, email")
    .eq("id", userId)
    .single()
  if (profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true
  return profile?.role === "admin"
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

  // Get auth user metadata for last_sign_in
  const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers()
  const authMap = new Map(authUsers?.map((u) => [u.id, u]) || [])

  const enriched = users?.map((u) => ({
    ...u,
    last_login: authMap.get(u.id)?.last_sign_in_at || null,
  }))

  // Count users per role
  const roleCounts: Record<string, number> = {}
  for (const u of users ?? []) {
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

  // Protect super admin — cannot be demoted or deactivated
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

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (role !== undefined) updates.role = role
  if (custom_permissions !== undefined) updates.custom_permissions = custom_permissions
  if (is_active !== undefined) updates.is_active = is_active

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .update(updates)
    .eq("id", user_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ user: data })
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

  // Check if email already exists in profiles (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email, role")
    .ilike("email", email)
    .single()

  if (existing) {
    // User exists — update their role instead of erroring
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("user_profiles")
      .update({ role, is_active: true, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single()
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })
    return NextResponse.json({ user: updated })
  }

  // Use Supabase Auth admin to create an invited user — this creates a real auth.users entry
  // so the user_profiles FK constraint is satisfied
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: false,
    user_metadata: { full_name: full_name || '', pre_enrolled: true, assigned_role: role },
  })

  if (authError) {
    // If user already exists in auth but not profiles, get their ID
    if (authError.message?.includes('already been registered') || authError.status === 422) {
      const { data: { users: authUsers } } = await supabaseAdmin.auth.admin.listUsers()
      const found = authUsers?.find((u) => u.email?.toLowerCase() === email.toLowerCase())
      if (found) {
        const { data, error } = await supabaseAdmin
          .from("user_profiles")
          .upsert({ id: found.id, email, role, full_name: full_name || null, is_active: true }, { onConflict: 'id' })
          .select()
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ user: data })
      }
    }
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  // Create the profile with the real auth user ID
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .insert({
      id: authUser.user.id,
      email,
      role,
      full_name: full_name || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ user: data })
}
