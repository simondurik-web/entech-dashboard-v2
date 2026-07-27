import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProfileFromHeader, canEditScheduling, canSeePayRate, getSchedulingViewer, forbidden, unauthorized } from '../_utils'

// Gated 2026-07-27: returned all 76 employees — name, employee ID, department
// and shift — to anonymous callers. (pay_rate was already role-stripped
// below, so wages were never exposed; the names were.)
export async function GET(req: NextRequest) {
  const caller = await getSchedulingViewer(req)
  if (!caller) return unauthorized()
  try {
    const url = new URL(req.url)
    const department = url.searchParams.get('department')
    const active = url.searchParams.get('active')

    let query = supabaseAdmin
      .from('scheduling_employees')
      .select('id, employee_id, first_name, last_name, department, default_shift, shift_length, pay_rate, is_active, created_at, updated_at')
      .order('last_name')

    if (department) query = query.eq('department', department)
    if (active !== null && active !== undefined) query = query.eq('is_active', active === 'true')

    const { data, error } = await query
    if (error) throw error

    // Strip pay_rate unless admin/manager (caller resolved above)
    const showPay = canSeePayRate(caller)

    const rows = (data || []).map((row: Record<string, unknown>) => {
      if (!showPay) {
        const { pay_rate: _, ...safe } = row
        return safe
      }
      return row
    })

    return NextResponse.json(rows)
  } catch (err) {
    console.error('Failed to fetch scheduling employees:', err)
    return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile || !canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { data, error } = await supabaseAdmin
      .from('scheduling_employees')
      .insert(body)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create employee'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile || !canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { id, employee_id, ...updates } = body

    if (!id && !employee_id) {
      return NextResponse.json({ error: 'id or employee_id required' }, { status: 400 })
    }

    const showPay = canSeePayRate({ role: profile.role, kind: "user" })
    if (!showPay) delete updates.pay_rate

    const { data, error } = await supabaseAdmin
      .from('scheduling_employees')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq(id ? 'id' : 'employee_id', id || employee_id)
      .select()
      .single()
    if (error) throw error
    // Strip pay_rate from the RESPONSE too, not just from the update. Dropping
    // it from `updates` stopped a group leader WRITING a wage but the returned
    // row still carried it — so a no-op PUT against any employee read their pay
    // rate back (codex, final review round). Same predicate as the GET.
    if (!showPay && data && 'pay_rate' in data) {
      const safe = { ...(data as Record<string, unknown>) }
      delete safe.pay_rate
      return NextResponse.json(safe)
    }
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update employee'
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

    const { data, error } = await supabaseAdmin
      .from('scheduling_employees')
      .update({ is_active: false })
      .eq('id', id)
      .select('id, employee_id, is_active')
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete employee'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
