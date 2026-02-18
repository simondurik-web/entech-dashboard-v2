import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

async function isAdmin(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return false
  const { createClient } = await import("@supabase/supabase-js")
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
  if (!user) return false
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
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

  return NextResponse.json({ users: enriched })
}

export async function PUT(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { id, role, custom_permissions, is_active } = body

  if (!id) return NextResponse.json({ error: "Missing user id" }, { status: 400 })

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (role !== undefined) updates.role = role
  if (custom_permissions !== undefined) updates.custom_permissions = custom_permissions
  if (is_active !== undefined) updates.is_active = is_active

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ user: data })
}
