import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProfileFromHeader, canEditScheduling, forbidden } from '../_utils'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('scheduling_machines')
      .select('*')
      .order('sort_order')
    if (error) throw error
    return NextResponse.json(data || [])
  } catch (err) {
    console.error('Failed to fetch machines:', err)
    return NextResponse.json({ error: 'Failed to fetch machines' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile || !canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { data, error } = await supabaseAdmin
      .from('scheduling_machines')
      .insert({ name: body.name, department: body.department || 'Molding' })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create machine'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const profile = await getProfileFromHeader(req)
  if (!profile || !canEditScheduling(profile.role)) return forbidden()

  try {
    const body = await req.json()
    const { id, ...updates } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('scheduling_machines')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update machine'
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

    const { error } = await supabaseAdmin.from('scheduling_machines').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete machine'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
