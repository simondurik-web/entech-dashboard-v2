import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { createClient } from "@supabase/supabase-js"

const DASHBOARD_APP_ID = "dashboard"
const QUALITY_APP_ID = "quality"

// Overlay the dashboard role (user_app_roles[dashboard]) onto the base
// user_profiles.role, and additionally attach the user's Quality-app role
// (user_app_roles[quality]) as `quality_role` so the integrated Quality
// section can gate on the SAME per-user roles the standalone EQDR app uses
// — no re-assignment of QA users required.
//
// Likewise attach `production_access` from the shared `users` table
// (app='production') — the pallet-registration app's own user store — so the
// integrated Pallet Records section keeps that app's exact access list.
async function overlayAppRole(profile: Record<string, unknown>) {
  if (!profile?.id) return profile
  const [{ data: appRoles }, { data: prodUser }] = await Promise.all([
    supabaseAdmin
      .from("user_app_roles")
      .select("app_id, role")
      .eq("user_id", profile.id)
      .in("app_id", [DASHBOARD_APP_ID, QUALITY_APP_ID]),
    supabaseAdmin
      .from("users")
      .select("role, status")
      .eq("id", profile.id)
      .eq("app", "production")
      .maybeSingle(),
  ])

  const dashboardRole = appRoles?.find((r) => r.app_id === DASHBOARD_APP_ID)?.role
  const qualityRole = appRoles?.find((r) => r.app_id === QUALITY_APP_ID)?.role ?? null

  return {
    ...profile,
    ...(dashboardRole ? { role: dashboardRole } : {}),
    quality_role: qualityRole,
    production_access: prodUser ? { role: prodUser.role, status: prodUser.status } : null,
  }
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
  // Identity comes ONLY from the verified token. Accepting id/email from the
  // body let an anonymous caller claim pre-enrolled rows or overwrite other
  // profiles via the admin client — hardened 2026-06-10.
  const user = await getUserFromRequest(req)
  if (!user?.id || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { full_name, avatar_url } = body
  const id = user.id
  const email = user.email

  // Check if a pre-enrolled profile exists with this email
  const { data: existing } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("email", email)
    .single()

  if (existing) {
    // Already fully synced (id claimed, name/avatar present or unchanged)?
    // Skip the write — this endpoint gets hit on logins, and an unconditional
    // UPDATE per login is wasted latency + churn.
    const nextName = full_name || existing.full_name
    const nextAvatar = avatar_url || existing.avatar_url
    if (
      existing.id === id &&
      existing.full_name === nextName &&
      existing.avatar_url === nextAvatar
    ) {
      const profileWithRole = await overlayAppRole(existing)
      return NextResponse.json({ profile: profileWithRole })
    }

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
