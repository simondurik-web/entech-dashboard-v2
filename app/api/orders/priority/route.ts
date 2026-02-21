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
  if (profile.role === "admin") return true
  if (profile.custom_permissions?.manage_priority) return true

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

  if (priority !== null && !VALID_PRIORITIES.includes(priority)) {
    return NextResponse.json(
      { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}, or null to reset` },
      { status: 400 }
    )
  }

  const lineStr = String(line)

  if (priority === null) {
    // Reset: delete the override row
    const { error } = await supabaseAdmin
      .from("priority_overrides")
      .delete()
      .eq("line", lineStr)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      order: { line: lineStr, priority_override: null, priority_changed_by: null, priority_changed_at: null },
    })
  }

  // Upsert the priority override
  const changedBy = profile.full_name || profile.email || userId
  const changedAt = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from("priority_overrides")
    .upsert(
      {
        line: lineStr,
        priority_override: priority,
        changed_by: changedBy,
        changed_at: changedAt,
      },
      { onConflict: "line" }
    )
    .select("line, priority_override, changed_by, changed_at")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    order: {
      line: lineStr,
      priority_override: priority,
      priority_changed_by: changedBy,
      priority_changed_at: changedAt,
    },
  })
}
