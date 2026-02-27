import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const employeeId = url.searchParams.get('employee_id')
    const entryId = url.searchParams.get('entry_id')
    const action = url.searchParams.get('action')
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const limit = parseInt(url.searchParams.get('limit') || '50')
    const offset = parseInt(url.searchParams.get('offset') || '0')

    let query = supabaseAdmin
      .from('scheduling_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (employeeId) query = query.eq('employee_id', employeeId)
    if (entryId) query = query.eq('entry_id', entryId)
    if (action) query = query.eq('action', action)
    if (from) query = query.gte('created_at', `${from}T00:00:00`)
    if (to) query = query.lte('created_at', `${to}T23:59:59`)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json(data || [])
  } catch (err) {
    console.error('Failed to fetch audit log:', err)
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 })
  }
}
