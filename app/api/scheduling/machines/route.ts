import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { canEditScheduling, forbidden, getRequestProfile, unauthorized } from "../_utils"

export async function GET(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()

  try {
    const url = new URL(req.url)
    const active = url.searchParams.get("active")

    let query = supabaseAdmin
      .from("scheduling_machines")
      .select("id, name, department, is_active, sort_order, created_at")
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })

    if (active === "true") query = query.eq("is_active", true)
    if (active === "false") query = query.eq("is_active", false)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json(data || [])
  } catch (err) {
    console.error("Failed to fetch scheduling machines:", err)
    return NextResponse.json({ error: "Failed to fetch scheduling machines" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { name, department = "Molding", sort_order = 0, is_active = true } = body || {}

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("scheduling_machines")
      .insert({
        name: String(name),
        department: String(department),
        sort_order: Number(sort_order) || 0,
        is_active: Boolean(is_active),
      })
      .select("id, name, department, is_active, sort_order, created_at")
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create machine"
    console.error("Failed to create scheduling machine:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { id, ...updates } = body || {}

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const payload: Record<string, unknown> = {}
    if (updates.name !== undefined) payload.name = String(updates.name)
    if (updates.department !== undefined) payload.department = String(updates.department)
    if (updates.sort_order !== undefined) payload.sort_order = Number(updates.sort_order) || 0
    if (updates.is_active !== undefined) payload.is_active = Boolean(updates.is_active)

    const { data, error } = await supabaseAdmin
      .from("scheduling_machines")
      .update(payload)
      .eq("id", id)
      .select("id, name, department, is_active, sort_order, created_at")
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update machine"
    console.error("Failed to update scheduling machine:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get("id")

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from("scheduling_machines")
      .update({ is_active: false })
      .eq("id", id)
      .select("id, name, department, is_active, sort_order, created_at")
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete machine"
    console.error("Failed to delete scheduling machine:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
