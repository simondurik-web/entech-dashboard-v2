import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

async function isAdmin(req: NextRequest): Promise<boolean> {
  const userId = req.headers.get("x-user-id")
  if (!userId) return false
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .single()
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
    last_sign_in: authMap.get(u.id)?.last_sign_in_at || null,
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

  // Check if email already exists
  const { data: existing } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("email", email)
    .single()

  if (existing) {
    return NextResponse.json({ error: "User with this email already exists" }, { status: 409 })
  }

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .insert({
      id: crypto.randomUUID(),
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
