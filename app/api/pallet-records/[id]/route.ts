import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  const updates: Record<string, unknown> = {
    edited_at: new Date().toISOString(),
  }

  if (body.weight !== undefined) updates.weight = body.weight
  if (body.length !== undefined) updates.length = body.length
  if (body.width !== undefined) updates.width = body.width
  if (body.height !== undefined) updates.height = body.height
  if (body.parts_per_pallet !== undefined) updates.parts_per_pallet = body.parts_per_pallet
  if (body.edited_by_name) updates.edited_by_name = body.edited_by_name
  if (body.edited_by) updates.edited_by = body.edited_by

  const { data, error } = await supabaseAdmin
    .from('pallet_records')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
