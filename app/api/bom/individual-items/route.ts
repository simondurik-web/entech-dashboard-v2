import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { recalculateCascade } from '@/lib/bom-recalculate'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('bom_individual_items')
    .select('*')
    .order('part_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
  })
}

export async function POST(req: Request) {
  const body = await req.json()
  const performedByName = body._performed_by_name || null
  const performedByEmail = body._performed_by_email || null
  delete body._performed_by_name
  delete body._performed_by_email

  const { data, error } = await supabaseAdmin
    .from('bom_individual_items')
    .insert(body)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('bom_audit').insert({
    entity_type: 'individual_item',
    entity_id: data.id,
    action: 'created',
    field_name: null,
    old_value: null,
    new_value: data.part_number,
    performed_by_name: performedByName,
    performed_by_email: performedByEmail,
  })

  return NextResponse.json(data)
}
