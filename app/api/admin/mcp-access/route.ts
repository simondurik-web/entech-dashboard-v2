/**
 * Admin management of MCP access (AI connector permissions).
 * GET: settings + per-user grants + recent request log.
 * PUT: { action: "set_global", enabled } — kill switch
 *      { action: "grant", user_id, scope? } — enable a user
 *      { action: "update", user_id, enabled?, scope? } — toggle/re-scope
 *      { action: "revoke", user_id } — remove grant AND revoke refresh tokens
 * Admin-gated with the same overlay rules as /api/admin/users.
 */
import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireUser } from "@/lib/require-user"

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const DASHBOARD_APP_ID = "dashboard"
const VALID_SCOPES = ["full_read", "production_only", "financial"]

async function requireAdmin(req: NextRequest): Promise<{ id: string; email: string | null } | null> {
  const user = await requireUser(req)
  if (!user) return null
  // Super-admin check uses the JWT-verified email (Supabase auth.getUser),
  // NOT user_profiles.email — profile rows are user-insertable (RLS
  // "Users can insert own profile"), so a DB-stored email is forgeable.
  if (user.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return user
  const { data: appRole } = await supabaseAdmin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("app_id", DASHBOARD_APP_ID)
    .single()
  return appRole?.role === "admin" ? user : null
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const [settings, grants, log] = await Promise.all([
    supabaseAdmin.from("mcp_settings").select("enabled, updated_by, updated_at").eq("id", 1).single(),
    supabaseAdmin
      .from("mcp_access")
      .select("user_id, email, enabled, scope, granted_by, created_at, updated_at")
      .order("created_at", { ascending: true }),
    supabaseAdmin
      .from("mcp_request_log")
      .select("ts, email, method, tool, ok, error, latency_ms")
      .order("ts", { ascending: false })
      .limit(30),
  ])

  return NextResponse.json({
    globalEnabled: settings.data?.enabled ?? false,
    grants: grants.data ?? [],
    recentRequests: log.data ?? [],
  })
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const action = typeof body.action === "string" ? body.action : ""
  const adminLabel = admin.email ?? admin.id

  if (action === "set_global") {
    const enabled = body.enabled === true
    const { error } = await supabaseAdmin
      .from("mcp_settings")
      .update({ enabled, updated_by: adminLabel, updated_at: new Date().toISOString() })
      .eq("id", 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const userId = typeof body.user_id === "string" ? body.user_id : ""
  if (!userId) return NextResponse.json({ error: "user_id required" }, { status: 400 })

  if (action === "grant") {
    const scope = VALID_SCOPES.includes(body.scope) ? body.scope : "full_read"
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email")
      .eq("id", userId)
      .single()
    if (!profile?.email) return NextResponse.json({ error: "User not found" }, { status: 404 })
    const { error } = await supabaseAdmin.from("mcp_access").upsert(
      {
        user_id: profile.id,
        email: profile.email,
        enabled: true,
        scope,
        granted_by: adminLabel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === "update") {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof body.enabled === "boolean") updates.enabled = body.enabled
    if (typeof body.scope === "string" && VALID_SCOPES.includes(body.scope)) updates.scope = body.scope
    const { error } = await supabaseAdmin.from("mcp_access").update(updates).eq("user_id", userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Disabling should also cut refresh tokens so the connector can't renew.
    if (updates.enabled === false) {
      await supabaseAdmin.from("mcp_oauth_tokens").update({ revoked: true }).eq("user_id", userId)
    }
    return NextResponse.json({ ok: true })
  }

  if (action === "revoke") {
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabaseAdmin.from("mcp_access").delete().eq("user_id", userId),
      supabaseAdmin.from("mcp_oauth_tokens").update({ revoked: true }).eq("user_id", userId),
    ])
    if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
