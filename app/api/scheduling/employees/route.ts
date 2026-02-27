import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import {
  canEditScheduling,
  canSeePayRate,
  getRequestProfile,
  forbidden,
  unauthorized,
  resolveEmployeeIdForRegular,
} from "../_utils"

export async function GET(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()

  try {
    const url = new URL(req.url)
    const department = url.searchParams.get("department")
    const active = url.searchParams.get("active")

    let query = supabaseAdmin
      .from("scheduling_employees")
      .select("id, employee_id, first_name, last_name, department, default_shift, shift_length, pay_rate, is_active, created_at, updated_at")
      .order("last_name")
      .order("first_name")

    if (department) query = query.eq("department", department)
    if (active === "true") query = query.eq("is_active", true)
    if (active === "false") query = query.eq("is_active", false)

    if (profile.role === "regular_user") {
      const ownEmployeeId = await resolveEmployeeIdForRegular(profile)
      if (!ownEmployeeId) return NextResponse.json([])
      query = query.eq("employee_id", ownEmployeeId)
    }

    const { data, error } = await query
    if (error) throw error

    const employees = (data || []).map((row) => {
      if (canSeePayRate(profile.role)) return row
      const { pay_rate: _payRate, ...safe } = row
      return safe
    })

    return NextResponse.json(employees)
  } catch (err) {
    console.error("Failed to fetch scheduling employees:", err)
    return NextResponse.json({ error: "Failed to fetch scheduling employees" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const {
      employee_id,
      first_name,
      last_name,
      department = "Molding",
      default_shift = 1,
      shift_length = 10,
      pay_rate,
      is_active = true,
    } = body || {}

    if (!employee_id || !first_name || !last_name) {
      return NextResponse.json({ error: "employee_id, first_name, and last_name are required" }, { status: 400 })
    }

    const insertPayload: Record<string, unknown> = {
      employee_id: String(employee_id),
      first_name: String(first_name),
      last_name: String(last_name),
      department: String(department),
      default_shift: Number(default_shift) === 2 ? 2 : 1,
      shift_length: Number(shift_length) || 10,
      is_active: Boolean(is_active),
    }

    if (canSeePayRate(profile.role) && pay_rate !== undefined && pay_rate !== null) {
      insertPayload.pay_rate = Number(pay_rate)
    }

    const { data, error } = await supabaseAdmin
      .from("scheduling_employees")
      .insert(insertPayload)
      .select("id, employee_id, first_name, last_name, department, default_shift, shift_length, pay_rate, is_active, created_at, updated_at")
      .single()

    if (error) throw error

    if (!canSeePayRate(profile.role)) {
      const { pay_rate: _payRate, ...safe } = data
      return NextResponse.json(safe, { status: 201 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create employee"
    console.error("Failed to create scheduling employee:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { id, employee_id, ...updates } = body || {}

    if (!id && !employee_id) {
      return NextResponse.json({ error: "id or employee_id is required" }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = { ...updates }

    if (updatePayload.default_shift !== undefined) {
      updatePayload.default_shift = Number(updatePayload.default_shift) === 2 ? 2 : 1
    }
    if (updatePayload.shift_length !== undefined) {
      updatePayload.shift_length = Number(updatePayload.shift_length)
    }

    if (!canSeePayRate(profile.role)) {
      delete updatePayload.pay_rate
    } else if (updatePayload.pay_rate !== undefined && updatePayload.pay_rate !== null) {
      updatePayload.pay_rate = Number(updatePayload.pay_rate)
    }

    const query = supabaseAdmin
      .from("scheduling_employees")
      .update(updatePayload)
      .eq(id ? "id" : "employee_id", id || employee_id)
      .select("id, employee_id, first_name, last_name, department, default_shift, shift_length, pay_rate, is_active, created_at, updated_at")
      .single()

    const { data, error } = await query
    if (error) throw error

    if (!canSeePayRate(profile.role)) {
      const { pay_rate: _payRate, ...safe } = data
      return NextResponse.json(safe)
    }

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update employee"
    console.error("Failed to update scheduling employee:", err)
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
    const employeeId = url.searchParams.get("employee_id")

    if (!id && !employeeId) {
      return NextResponse.json({ error: "id or employee_id is required" }, { status: 400 })
    }

    const query = supabaseAdmin
      .from("scheduling_employees")
      .update({ is_active: false })
      .eq(id ? "id" : "employee_id", id || employeeId)
      .select("id, employee_id, first_name, last_name, is_active")
      .single()

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete employee"
    console.error("Failed to soft delete scheduling employee:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
