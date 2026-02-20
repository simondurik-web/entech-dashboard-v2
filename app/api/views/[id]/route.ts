import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('saved_views')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json()

  // Only allow owner to update (super admin can also update)
  let query = supabaseAdmin.from('saved_views').update(body).eq('id', id)
  if (userId.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
    query = query.eq('user_id', userId)
  }

  const { data, error } = await query.select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = _req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Super admin can delete anyone's view
  let query = supabaseAdmin.from('saved_views').delete().eq('id', id)
  if (userId.toLowerCase() !== SUPER_ADMIN_EMAIL.toLowerCase()) {
    query = query.eq('user_id', userId)
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
