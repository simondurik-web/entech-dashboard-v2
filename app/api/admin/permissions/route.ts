import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"

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

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("role_permissions")
    .select("*")
    .order("sort_order")

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Count users per role
  const { data: profiles } = await supabaseAdmin
    .from("user_profiles")
    .select("role")

  const roleCounts: Record<string, number> = {}
  for (const p of profiles ?? []) {
    roleCounts[p.role] = (roleCounts[p.role] || 0) + 1
  }

  // Normalize menu_access: convert object {path: true} to array [path]
  const normalized = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    menu_access: Array.isArray(r.menu_access)
      ? r.menu_access
      : Object.keys(r.menu_access as Record<string, boolean>).filter(
          (k) => (r.menu_access as Record<string, boolean>)[k]
        ),
  }))

  return NextResponse.json({ roles: normalized, roleCounts })
}

export async function PUT(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const { role, menu_access } = body

  if (!role || !menu_access) {
    return NextResponse.json({ error: "Missing role or menu_access" }, { status: 400 })
  }

  // Convert array to object format for DB storage
  const menuAccessObj = Array.isArray(menu_access)
    ? Object.fromEntries(menu_access.map((p: string) => [p, true]))
    : menu_access

  const { data, error } = await supabaseAdmin
    .from("role_permissions")
    .update({ menu_access: menuAccessObj, updated_at: new Date().toISOString() })
    .eq("role", role)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ permission: data })
}
