import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const page = req.nextUrl.searchParams.get('page')
  const userId = req.headers.get('x-user-id')

  if (!page) return NextResponse.json({ error: 'page required' }, { status: 400 })

  let query = supabaseAdmin.from('saved_views').select('*').eq('page', page).order('created_at', { ascending: false })

  if (userId) {
    query = query.or(`user_id.eq.${userId},shared.eq.true`)
  } else {
    query = query.eq('shared', true)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json()
  const { page, name, config, shared } = body
  if (!page || !name) return NextResponse.json({ error: 'page and name required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('saved_views')
    .insert({ user_id: userId, page, name, config: config ?? {}, shared: Boolean(shared) })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
