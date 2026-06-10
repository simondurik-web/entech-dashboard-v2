import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { logQualityCreate, logQualityUpdate } from "@/lib/quality/audit"
import { actorName, errorJson, requireQualityActor } from "@/lib/quality/api"

const APP_ID = "quality"
const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const ASSIGNABLE_ROLES = new Set(["visitor", "operator", "group_leader", "qa_manager", "manager", "admin"])

type UserProfileRow = {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
}

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

// Strict-enough email shape check. Critically rejects '%' (LIKE wildcard) so a
// crafted "email" like %@gmail.com can't wildcard-match other users' rows via
// .ilike and bypass the exact-match super-admin guard.
function isValidEmail(email: string): boolean {
  return /^[^\s%@]+@[^\s%@]+\.[^\s%@]+$/.test(email)
}

// Escape LIKE wildcards for .ilike — '_' is legal in emails but is a
// single-char wildcard in LIKE patterns.
function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1")
}

function roleOrNull(role: unknown): string | null {
  return typeof role === "string" && ASSIGNABLE_ROLES.has(role) ? role : null
}

async function loadTarget(userId: string) {
  // No custom_permissions / role here: this row is returned to the (QA-scoped)
  // client in PUT responses and must not leak dashboard-wide fields.
  const { data } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email, full_name, avatar_url, is_active, created_at")
    .eq("id", userId)
    .single()
  return data as UserProfileRow | null
}

function blockedTarget(actorId: string, target: UserProfileRow | null) {
  if (!target) return "User not found"
  if (target.email?.toLowerCase() === SUPER_ADMIN_EMAIL) return "Cannot modify super admin"
  if (target.id === actorId) return "Cannot modify yourself"
  return null
}

export async function GET(req: Request) {
  const gate = await requireQualityActor(req, "manage")
  if ("response" in gate) return gate.response

  // Deliberately NOT selecting custom_permissions or exposing the dashboard
  // role: a QA admin is not necessarily a dashboard admin, and this endpoint
  // must not leak dashboard-wide permission data across the app boundary.
  const { data: users, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, email, full_name, avatar_url, is_active, created_at")
    .order("created_at", { ascending: false })
  if (error) {
    console.error("quality/users GET failed:", error)
    return errorJson("Failed to load users", 500)
  }

  const { data: appRoles } = await supabaseAdmin
    .from("user_app_roles")
    .select("user_id, role, updated_at")
    .eq("app_id", APP_ID)

  const roleMap = new Map((appRoles || []).map((r) => [r.user_id, r.role]))
  // Default page size is 50 — request a high ceiling so last_login doesn't
  // silently disappear once the user count grows past one page.
  const { data: authList, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (authErr) console.error("quality/users listUsers failed:", authErr)
  const authMap = new Map((authList?.users ?? []).map((u) => [u.id, u]))

  return NextResponse.json({
    users: (users || []).map((u) => ({
      ...u,
      role: u.email?.toLowerCase() === SUPER_ADMIN_EMAIL ? "admin" : roleMap.get(u.id) || "visitor",
      last_login: authMap.get(u.id)?.last_sign_in_at || null,
    })),
  })
}

export async function POST(req: Request) {
  const gate = await requireQualityActor(req, "manage")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Record<string, unknown>
    const email = normalizeEmail(body.email)
    const role = roleOrNull(body.role)
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : ""
    if (!email || !role) return errorJson("Missing email or role", 400)
    if (!isValidEmail(email)) return errorJson("Invalid email address", 400)
    if (email === SUPER_ADMIN_EMAIL) return errorJson("Cannot modify super admin", 403)

    const { data: existingProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email, full_name, avatar_url, role, is_active, created_at")
      .ilike("email", escapeLike(email))
      .maybeSingle()

    // Defense in depth: re-check the RESOLVED row, not just the input string.
    if (existingProfile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL) {
      return errorJson("Cannot modify super admin", 403)
    }

    let userId = existingProfile?.id as string | undefined
    let profile = existingProfile as UserProfileRow | null

    if (!userId) {
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const found = (list?.users ?? []).find((u) => u.email?.toLowerCase() === email)
      if (found) {
        userId = found.id
      } else {
        const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: false,
          user_metadata: { full_name: fullName, pre_enrolled: true },
        })
        if (authError || !created.user) {
          console.error("quality/users createUser failed:", authError)
          return errorJson("Failed to create user", 500)
        }
        userId = created.user.id
      }

      // ignoreDuplicates: if a profile row already exists for this auth id we
      // must NOT overwrite it (the old onConflict-update path would have reset
      // the dashboard role to 'visitor' and re-activated a deactivated user —
      // a write a quality-scoped admin must never perform). Insert-if-absent,
      // then read back whichever row exists.
      const { error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .upsert(
          { id: userId, email, role: "visitor", full_name: fullName || null, is_active: true },
          { onConflict: "id", ignoreDuplicates: true },
        )
      if (profileError) {
        console.error("quality/users profile upsert failed:", profileError)
        return errorJson("Failed to create profile", 500)
      }
      profile = await loadTarget(userId)
    }

    if (!userId) return errorJson("Failed to resolve user", 500)
    // Apply the same self-protection as PUT/DELETE (super admin already blocked by email above).
    if (userId === gate.actor.userId) return errorJson("Cannot modify yourself", 403)

    const { error: roleError } = await supabaseAdmin
      .from("user_app_roles")
      .upsert({ user_id: userId, app_id: APP_ID, role, updated_at: new Date().toISOString() }, { onConflict: "user_id,app_id" })
    if (roleError) {
      console.error("quality/users POST role upsert failed:", roleError)
      return errorJson("Failed to assign role", 500)
    }

    await logQualityCreate("user_app_roles", 0, { user_id: userId, app_id: APP_ID, role }, actorName(gate.actor), gate.actor.email)
    return NextResponse.json({ user: { ...profile, role } })
  } catch (err) {
    console.error("quality/users POST exception:", err)
    return errorJson("Internal server error", 500)
  }
}

export async function PUT(req: Request) {
  const gate = await requireQualityActor(req, "manage")
  if ("response" in gate) return gate.response

  try {
    const body = await req.json() as Record<string, unknown>
    const userId = typeof body.user_id === "string" ? body.user_id : ""
    if (!userId) return errorJson("Missing user id", 400)
    const target = await loadTarget(userId)
    const blocked = blockedTarget(gate.actor.userId, target)
    if (blocked) return errorJson(blocked, blocked === "User not found" ? 404 : 403)

    const role = roleOrNull(body.role)
    if (body.role !== undefined && !role) return errorJson("Invalid role", 400)

    if (role) {
      const { data: oldRole } = await supabaseAdmin
        .from("user_app_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("app_id", APP_ID)
        .maybeSingle()
      const { error } = await supabaseAdmin
        .from("user_app_roles")
        .upsert({ user_id: userId, app_id: APP_ID, role, updated_at: new Date().toISOString() }, { onConflict: "user_id,app_id" })
      if (error) return errorJson("Failed to update role", 500)
      await logQualityUpdate("user_app_roles", 0, { role: oldRole?.role ?? null }, { role }, actorName(gate.actor), gate.actor.email)
    }

    // Quality user management is scoped to the QA role only (user_app_roles[quality]).
    // It deliberately does NOT write global user_profiles fields like
    // custom_permissions or is_active — those are dashboard-wide and a QA admin
    // (who may not be a dashboard admin) must not be able to change them here.
    const profile = await loadTarget(userId)
    let effectiveRole = role
    if (!effectiveRole) {
      const { data: current } = await supabaseAdmin
        .from("user_app_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("app_id", APP_ID)
        .maybeSingle()
      effectiveRole = current?.role ?? "visitor"
    }
    return NextResponse.json({ user: { ...profile, role: effectiveRole } })
  } catch (err) {
    console.error("quality/users PUT exception:", err)
    return errorJson("Internal server error", 500)
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requireQualityActor(req, "manage")
  if ("response" in gate) return gate.response

  const userId = req.nextUrl.searchParams.get("user_id") || ""
  if (!userId) return errorJson("Missing user_id", 400)
  const target = await loadTarget(userId)
  const blocked = blockedTarget(gate.actor.userId, target)
  if (blocked) return errorJson(blocked, blocked === "User not found" ? 404 : 403)

  const { data: oldRole } = await supabaseAdmin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("app_id", APP_ID)
    .maybeSingle()

  const { error } = await supabaseAdmin
    .from("user_app_roles")
    .delete()
    .eq("user_id", userId)
    .eq("app_id", APP_ID)
  if (error) return errorJson("Failed to remove Quality role", 500)

  await logQualityUpdate("user_app_roles", 0, { user_id: userId, app_id: APP_ID, role: oldRole?.role ?? null }, { user_id: userId, app_id: APP_ID, role: null }, actorName(gate.actor), gate.actor.email)
  return NextResponse.json({ ok: true })
}
