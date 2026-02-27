import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProfileFromHeader, canEditScheduling, forbidden, normalizeDateInput } from '../_utils'

function getDefaultTimes(shift: number) {
  return shift === 2 ? { start_time: '17:30', end_time: '04:30' } : { start_time: '07:00', end_time: '17:30' }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const employeeId = url.searchParams.get('employee_id')
    const shift = url.searchParams.get('shift')
    const department = url.searchParams.get('department')

    let query = supabaseAdmin
      .from('scheduling_entries')
      .select(`
        id, employee_id, date, shift, start_time, end_time, machine_id, hours,
        created_by, created_at, updated_at,
        scheduling_employees!inner(first_name, last_name, department),
        scheduling_machines(name)
      `)
      .order('date', { ascending: true })

    if (from) query = query.gte('date', normalizeDateInput(from))
    if (to) query = query.lte('date', normalizeDateInput(to))
    if (employeeId) query = query.eq('employee_id', employeeId)
    if (shift) query = query.eq('shift', Number(shift))
    if (department) query = query.eq('scheduling_employees.department', department)

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
      first_name: row.scheduling_employees?.first_name || '',
      last_name: row.scheduling_employees?.last_name || '',
      department: row.scheduling_employees?.department || '',
    }))

    return NextResponse.json(rows)
  } catch (err) {
    console.error('Failed to fetch scheduling entries:', err)
    return NextResponse.json({ error: 'Failed to fetch entries' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile || !canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const applyTo = body?.applyTo as string | undefined

    // Expand single entry to multiple dates based on applyTo
    let rawEntries: any[]
    if (applyTo && !Array.isArray(body) && (applyTo === 'onward' || applyTo === 'week')) {
      const baseDate = new Date(body.date + 'T12:00:00')
      rawEntries = []

      if (applyTo === 'week') {
        const day = baseDate.getDay()
        const monday = new Date(baseDate)
        monday.setDate(monday.getDate() - ((day + 6) % 7))
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday)
          d.setDate(d.getDate() + i)
          rawEntries.push({ ...body, date: d.toISOString().split('T')[0] })
        }
      } else {
        for (let i = 0; i < 28; i++) {
          const d = new Date(baseDate)
          d.setDate(d.getDate() + i)
          rawEntries.push({ ...body, date: d.toISOString().split('T')[0] })
        }
      }
    } else if (Array.isArray(body)) {
      rawEntries = body
    } else {
      rawEntries = [body]
    }

    // Normalize entries
    const entries = rawEntries.map((e: any) => {
      const shift = Number(e.shift) === 2 ? 2 : 1
      const defaults = getDefaultTimes(shift)
      return {
        employee_id: String(e.employee_id),
        date: normalizeDateInput(String(e.date)),
        shift,
        start_time: e.start_time || defaults.start_time,
        end_time: e.end_time || defaults.end_time,
        machine_id: e.machine_id || null,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      }
    })

    const { data, error } = await supabaseAdmin
      .from('scheduling_entries')
      .upsert(entries, { onConflict: 'employee_id,date,shift' })
      .select()

    if (error) throw error
    return NextResponse.json(data || [], { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create entry'
    console.error('Failed to create scheduling entries:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile || !canEditScheduling(profile.role)) return forbidden()

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { error } = await supabaseAdmin.from('scheduling_entries').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete entry'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
