import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

const VALID_PRIORITIES = ["P1", "P2", "P3", "P4", "URGENT"]

async function getUserProfile(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_profiles")
    .select("role, email, full_name, custom_permissions")
    .eq("id", userId)
    .single()
  return data
}

async function hasManagePriority(profile: { role: string; custom_permissions?: Record<string, boolean> | null }): Promise<boolean> {
  // Admin always has access
  if (profile.role === "admin") return true

  // Check custom_permissions first
  if (profile.custom_permissions?.manage_priority) return true

  // Check role-based permissions
  const { data: rolePerm } = await supabaseAdmin
    .from("role_permissions")
    .select("menu_access")
    .eq("role", profile.role)
    .single()

  if (!rolePerm) return false
  const access = rolePerm.menu_access as Record<string, boolean>
  return access?.manage_priority === true
}

export async function PUT(req: NextRequest) {
  const userId = req.headers.get("x-user-id")
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const profile = await getUserProfile(userId)
  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  if (!(await hasManagePriority(profile))) {
    return NextResponse.json({ error: "No manage_priority permission" }, { status: 403 })
  }

  const body = await req.json()
  const { line, priority } = body

  if (!line) {
    return NextResponse.json({ error: "Missing line" }, { status: 400 })
  }

  // priority = null means "reset to calculated"
  if (priority !== null && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}, or null to reset` }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {
    priority_override: priority,
    priority_changed_by: profile.full_name || profile.email || userId,
    priority_changed_at: new Date().toISOString(),
  }

  // If resetting, clear the override fields
  if (priority === null) {
    updateData.priority_override = null
    updateData.priority_changed_by = null
    updateData.priority_changed_at = null
  }

  // line could be string or number in DB — try both
  const lineStr = String(line)
  
  const { data, error } = await supabaseAdmin
    .from("dashboard_orders")
    .update(updateData)
    .eq("line", lineStr)
    .select("line, priority_override, priority_changed_by, priority_changed_at")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ error: `No order found with line ${lineStr}` }, { status: 404 })
  }

  return NextResponse.json({ success: true, order: data[0] })
}
