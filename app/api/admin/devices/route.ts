import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

// Admin management of authorized devices (shared floor computers).
// Same guard pattern as /api/admin/users.

const SUPER_ADMIN_EMAIL = "simondurik@gmail.com"
const DASHBOARD_APP_ID = "dashboard"

// A device can act as any of these, but never as an admin — approving a
// device must not mint an unattended admin terminal on the shop floor.
const ALLOWED_DEVICE_ROLES = new Set([
  "visitor",
  "regular_user",
  "advanced_user",
  "group_leader",
  "shipping_manager",
  "manager",
])

async function isAdmin(req: NextRequest): Promise<{ ok: boolean; userId: string | null }> {
  const userId = req.headers.get("x-user-id")
  if (!userId) return { ok: false, userId: null }
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email")
    .eq("id", userId)
    .single()
  if (profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return { ok: true, userId }
  const { data } = await supabaseAdmin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("app_id", DASHBOARD_APP_ID)
    .single()
  return { ok: data?.role === "admin", userId }
}

export async function GET(req: NextRequest) {
  const { ok } = await isAdmin(req)
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { data: devices, error } = await supabaseAdmin
    .from("authorized_devices")
    .select("id, pairing_code, name, role, status, user_agent, requested_at, approved_at, last_seen_at")
    .order("requested_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ devices })
}

export async function PUT(req: NextRequest) {
  const { ok, userId } = await isAdmin(req)
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const { id, action, role, name } = body as {
    id?: string
    action?: "approve" | "revoke"
    role?: string
    name?: string
  }
  if (!id) return NextResponse.json({ error: "Missing device id" }, { status: 400 })

  if (role !== undefined && !ALLOWED_DEVICE_ROLES.has(role)) {
    return NextResponse.json({ error: "Role not allowed for devices" }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (role !== undefined) updates.role = role
  if (name !== undefined) updates.name = String(name).slice(0, 80).trim() || "Unnamed device"
  if (action === "approve") {
    updates.status = "approved"
    updates.approved_at = new Date().toISOString()
    updates.approved_by = userId
  } else if (action === "revoke") {
    updates.status = "revoked"
  }

  const { data: device, error } = await supabaseAdmin
    .from("authorized_devices")
    .update(updates)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ device })
}

export async function DELETE(req: NextRequest) {
  const { ok } = await isAdmin(req)
  if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = (body as { id?: string }).id
  if (!id) return NextResponse.json({ error: "Missing device id" }, { status: 400 })

  const { error } = await supabaseAdmin.from("authorized_devices").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
