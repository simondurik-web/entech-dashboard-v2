import { NextResponse } from 'next/server'
import { BomAuthoringError, createFinalAssembly } from '@/lib/bom-authoring'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('bom_final_assemblies')
    .select('*, bom_final_assembly_components(*)')
    .order('part_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
  })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const performedByName = body._performed_by_name || null
    const performedByEmail = body._performed_by_email || null
    delete body._performed_by_name
    delete body._performed_by_email

    const data = await createFinalAssembly(body)

    await supabaseAdmin.from('bom_audit').insert({
      entity_type: 'final_assembly',
      entity_id: data.id,
      action: 'created',
      field_name: null,
      old_value: null,
      new_value: data.part_number,
      performed_by_name: performedByName,
      performed_by_email: performedByEmail,
    })

    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof BomAuthoringError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to create final assembly.' }, { status: 500 })
  }
}
