import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
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
  const body = await req.json()
  const userId = req.headers.get('x-user-id') || undefined

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
