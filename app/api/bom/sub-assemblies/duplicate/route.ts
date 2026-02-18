import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: Request) {
  const { id, new_part_number } = await req.json()
  
  const { data: original } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .select('*, bom_sub_assembly_components(*)')
    .eq('id', id)
    .single()
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id: _id, created_at, updated_at, bom_sub_assembly_components, ...rest } = original
  const { data: newAssembly, error } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .insert({ ...rest, part_number: new_part_number || `${rest.part_number}-COPY` })
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

  return NextResponse.json(newAssembly)
}
