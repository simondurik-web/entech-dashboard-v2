import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser } from '@/lib/require-user'

export async function POST(req: NextRequest) {
  if (!(await requireUser(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, new_part_number, _performed_by_name, _performed_by_email } = await req.json()

  const { data: original } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .select('*, bom_sub_assembly_components(*)')
    .eq('id', id)
    .single()
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id: _id, created_at, updated_at, bom_sub_assembly_components, ...rest } = original
  const newPartNumber = new_part_number || `${rest.part_number}-COPY`
  const { data: newAssembly, error } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .insert({ ...rest, part_number: newPartNumber })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (bom_sub_assembly_components?.length) {
    const comps = bom_sub_assembly_components.map((c: Record<string, unknown>) => {
      const { id: _cid, created_at: _ca, sub_assembly_id: _sid, ...compRest } = c
      return { ...compRest, sub_assembly_id: newAssembly.id }
    })
    await supabaseAdmin.from('bom_sub_assembly_components').insert(comps)
  }

  // Audit log
  await supabaseAdmin.from('bom_audit').insert({
    entity_type: 'sub_assembly',
    entity_id: newAssembly.id,
    action: 'duplicated',
    field_name: null,
    old_value: `Cloned from ${original.part_number}`,
    new_value: newPartNumber,
    performed_by_name: _performed_by_name || null,
    performed_by_email: _performed_by_email || null,
  })

  return NextResponse.json(newAssembly)
}
