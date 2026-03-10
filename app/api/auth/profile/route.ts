import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { createClient } from "@supabase/supabase-js"

const DASHBOARD_APP_ID = "dashboard"

async function overlayAppRole(profile: Record<string, unknown>) {
  if (!profile?.id) return profile
  const { data: appRole } = await supabaseAdmin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", profile.id)
    .eq("app_id", DASHBOARD_APP_ID)
    .single()
  if (appRole) return { ...profile, role: appRole.role }
  return profile
}

async function getUserFromRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null
  const token = authHeader.slice(7)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  return user
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  const withAppRole = profile ? await overlayAppRole(profile) : profile
  return NextResponse.json({ profile: withAppRole })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { id, email, full_name, avatar_url } = body

  if (!id || !email) {
    return NextResponse.json({ error: "Missing id or email" }, { status: 400 })
  }

  // Check if a pre-enrolled profile exists with this email
  const { data: existing } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("email", email)
    .single()

  if (existing) {
    // Update the pre-enrolled row: set the real auth id, name, avatar, but KEEP existing role
    const { data: profile, error } = await supabaseAdmin
      .from("user_profiles")
      .update({
        id,
        full_name: full_name || existing.full_name,
        avatar_url: avatar_url || existing.avatar_url,
        updated_at: new Date().toISOString(),
      })
      .eq("email", email)
      .select()
      .single()

    if (error) {
      console.error("Profile update error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const profileWithRole = await overlayAppRole(profile)
    return NextResponse.json({ profile: profileWithRole })
  }

  // No pre-enrolled profile — insert new (super admin gets admin, others get visitor)
  const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
  const defaultRole = email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() ? "admin" : "visitor"

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .insert({
      id,
      email,
      full_name: full_name || null,
      avatar_url: avatar_url || null,
      role: defaultRole,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    // If insert fails due to id conflict (user already exists by id), update instead
    if (error.code === "23505") {
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from("user_profiles")
        .update({
          email,
          full_name: full_name || null,
          avatar_url: avatar_url || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single()

      if (updateErr) {
        console.error("Profile update error:", updateErr)
        return NextResponse.json({ error: updateErr.message }, { status: 500 })
      }
      const updatedWithRole = await overlayAppRole(updated)
      return NextResponse.json({ profile: updatedWithRole })
    }

    console.error("Profile insert error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const newProfileWithRole = await overlayAppRole(profile)
  return NextResponse.json({ profile: newProfileWithRole })
}
