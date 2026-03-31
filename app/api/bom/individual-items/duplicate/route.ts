import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: Request) {
  const { id, new_part_number, _performed_by_name, _performed_by_email } = await req.json()

  const { data: original } = await supabaseAdmin
    .from('bom_individual_items')
    .select('*')
    .eq('id', id)
    .single()
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id: _id, created_at, updated_at, ...rest } = original
  const newPartNumber = new_part_number || `${rest.part_number}-COPY`
  const { data: newItem, error } = await supabaseAdmin
    .from('bom_individual_items')
    .insert({ ...rest, part_number: newPartNumber })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log
  await supabaseAdmin.from('bom_audit').insert({
    entity_type: 'individual_item',
    entity_id: newItem.id,
    action: 'duplicated',
    field_name: null,
    old_value: `Cloned from ${original.part_number}`,
    new_value: newPartNumber,
    performed_by_name: _performed_by_name || null,
    performed_by_email: _performed_by_email || null,
  })

  return NextResponse.json(newItem)
}
