import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireDashboardAccess } from '@/lib/require-user'

// Gated 2026-07-27 — see /api/labels. Label activity names the operator who
// printed each label.
export async function GET(req: NextRequest) {
  if (!(await requireDashboardAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = (page - 1) * limit

  const { data, error, count } = await supabaseAdmin
    .from('label_activity_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [], total: count ?? 0, page, limit })
}

export async function POST(req: NextRequest) {
  // Auth before parsing the body — see the note on POST /api/labels.
  const actor = await requireDashboardAccess(req)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = actor.id

  const body = await req.json()

  const { data, error } = await supabaseAdmin
    .from('label_activity_log')
    .insert({
      label_id: body.label_id || null,
      order_line: body.order_line,
      action: body.action,
      status: body.status || 'info',
      recipients: body.recipients || null,
      pdf_url: body.pdf_url || null,
      notes: body.notes || null,
      created_by: userId || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
