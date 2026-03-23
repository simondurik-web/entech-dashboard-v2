import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data, error } = await supabaseAdmin
    .from('labels')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const userId = req.headers.get('x-user-id') || undefined

  const updates: Record<string, unknown> = {}

  if (body.label_status) {
    updates.label_status = body.label_status
    if (body.label_status === 'printed') {
      updates.printed_by = userId || null
      updates.printed_at = new Date().toISOString()
    }
  }
  if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to
  if (body.emailed_to) {
    updates.emailed_to = body.emailed_to
    updates.emailed_at = new Date().toISOString()
  }
  if (body.error_message !== undefined) updates.error_message = body.error_message

  const { data, error } = await supabaseAdmin
    .from('labels')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Log activity
  if (body.label_status) {
    await supabaseAdmin.from('label_activity_log').insert({
      label_id: id,
      order_line: data.order_line,
      action: body.label_status,
      status: 'success',
      notes: `Status changed to ${body.label_status}`,
      created_by: userId || null,
    })
  }

  return NextResponse.json(data)
}
