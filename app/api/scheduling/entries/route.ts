import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
import {
  canEditScheduling,
  forbidden,
  getIndianapolisTodayIso,
  getRequestProfile,
  normalizeDateInput,
  resolveEmployeeIdForRegular,
  unauthorized,
} from "../_utils"

type EntryInput = {
  id?: string
  employee_id: string
  date: string
  shift: 1 | 2
  start_time?: string
  end_time?: string
  machine_id?: string | null
}

function getDefaultTimes(shift: 1 | 2) {
  return shift === 2 ? { start_time: "17:30", end_time: "04:30" } : { start_time: "07:00", end_time: "17:30" }
}

function normalizeEntry(entry: EntryInput, createdBy?: string) {
  const shift = Number(entry.shift) === 2 ? 2 : 1
  const defaults = getDefaultTimes(shift)
  return {
    id: entry.id,
    employee_id: String(entry.employee_id),
    date: normalizeDateInput(String(entry.date)),
    shift,
    start_time: entry.start_time || defaults.start_time,
    end_time: entry.end_time || defaults.end_time,
    machine_id: entry.machine_id || null,
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  }
}

async function listEntries(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()

  const url = new URL(req.url)
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  const employeeId = url.searchParams.get("employee_id")
  const shift = url.searchParams.get("shift")
  const department = url.searchParams.get("department")

  let query = supabaseAdmin
    .from("scheduling_entries")
    .select(
      `
      id,
      employee_id,
      date,
      shift,
      start_time,
      end_time,
      machine_id,
      hours,
      created_by,
      created_at,
      updated_at,
      scheduling_employees!inner(first_name,last_name,department),
      scheduling_machines(name)
    `
    )
    .order("date", { ascending: true })

  if (from) query = query.gte("date", normalizeDateInput(from))
  if (to) query = query.lte("date", normalizeDateInput(to))
  if (employeeId) query = query.eq("employee_id", employeeId)
  if (shift) query = query.eq("shift", Number(shift) === 2 ? 2 : 1)
  if (department) query = query.eq("scheduling_employees.department", department)

  if (profile.role === "regular_user") {
    const ownEmployeeId = await resolveEmployeeIdForRegular(profile)
    if (!ownEmployeeId) return NextResponse.json([])

    query = query.eq("employee_id", ownEmployeeId)
    query = query.gte("date", getIndianapolisTodayIso())
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data || []).map((row: any) => ({
    id: row.id,
    employee_id: row.employee_id,
    date: row.date,
    shift: row.shift,
    start_time: row.start_time,
    end_time: row.end_time,
    machine_id: row.machine_id,
    machine_name: row.scheduling_machines?.name || null,
    hours: row.hours,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    first_name: row.scheduling_employees?.first_name || "",
    last_name: row.scheduling_employees?.last_name || "",
    department: row.scheduling_employees?.department || "",
  }))

  return NextResponse.json(rows)
}

export async function GET(req: NextRequest) {
  try {
    return await listEntries(req)
  } catch (err) {
    console.error("Failed to fetch scheduling entries:", err)
    return NextResponse.json({ error: "Failed to fetch scheduling entries" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()

    // Handle applyTo logic (expand single entry to multiple dates)
    const applyTo = body?.applyTo as string | undefined
    let entries: EntryInput[]

    if (applyTo && !Array.isArray(body) && (applyTo === 'onward' || applyTo === 'week')) {
      const baseDate = new Date(body.date + 'T12:00:00')
      const generated: EntryInput[] = []

      if (applyTo === 'week') {
        // Find Monday of the week containing baseDate
        const day = baseDate.getDay()
        const monday = new Date(baseDate)
        monday.setDate(monday.getDate() - ((day + 6) % 7))
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday)
          d.setDate(d.getDate() + i)
          generated.push({ ...body, date: d.toISOString().split('T')[0] })
        }
      } else {
        // 'onward' — fill from baseDate to end of next 4 weeks (28 days)
        for (let i = 0; i < 28; i++) {
          const d = new Date(baseDate)
          d.setDate(d.getDate() + i)
          generated.push({ ...body, date: d.toISOString().split('T')[0] })
        }
      }
      entries = generated
    } else if (Array.isArray(body)) {
      entries = body
    } else if (body?.entries && Array.isArray(body.entries)) {
      entries = body.entries
    } else {
      entries = [body]
    }

    const list: EntryInput[] = entries

    if (!list.length) {
      return NextResponse.json({ error: "At least one scheduling entry is required" }, { status: 400 })
    }

    const upsertRows = list.map((entry) => {
      const normalized = normalizeEntry(entry, profile.id)
      // Remove applyTo from the row — it's not a DB column
      const { ...row } = normalized as Record<string, unknown>
      delete row.applyTo
      return row
    })

    const { data, error } = await supabaseAdmin
      .from("scheduling_entries")
      .upsert(upsertRows, { onConflict: "employee_id,date" })
      .select("id, employee_id, date, shift, start_time, end_time, machine_id, hours, created_at, updated_at")

    if (error) throw error
    return NextResponse.json(data || [], { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create scheduling entry"
    console.error("Failed to create scheduling entries:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const profile = await getRequestProfile(req)
  if (!profile) return unauthorized()
  if (!canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { id, ...raw } = body || {}

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (raw.shift !== undefined) payload.shift = Number(raw.shift) === 2 ? 2 : 1
    if (raw.start_time !== undefined) payload.start_time = raw.start_time
    if (raw.end_time !== undefined) payload.end_time = raw.end_time
    if (raw.machine_id !== undefined) payload.machine_id = raw.machine_id || null
    if (raw.date !== undefined) payload.date = normalizeDateInput(String(raw.date))
    if (raw.employee_id !== undefined) payload.employee_id = String(raw.employee_id)

    const { data, error } = await supabaseAdmin
      .from("scheduling_entries")
      .update(payload)
      .eq("id", id)
      .select("id, employee_id, date, shift, start_time, end_time, machine_id, hours, created_at, updated_at")
      .single()

    if (error) throw error
    return NextResponse.json(data)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update scheduling entry"
    console.error("Failed to update scheduling entry:", err)
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

    const { error } = await supabaseAdmin.from("scheduling_entries").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete scheduling entry"
    console.error("Failed to delete scheduling entry:", err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
