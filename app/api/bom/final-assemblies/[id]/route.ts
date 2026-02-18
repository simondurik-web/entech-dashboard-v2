import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { recalculateCascade } from '@/lib/bom-recalculate'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const { components, ...assemblyData } = body
  assemblyData.updated_at = new Date().toISOString()
  
  const { data, error } = await supabaseAdmin
    .from('bom_final_assemblies')
    .update(assemblyData)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (components) {
    await supabaseAdmin.from('bom_final_assembly_components').delete().eq('final_assembly_id', id)
    if (components.length) {
      const comps = components.map((c: Record<string, unknown>, i: number) => ({ ...c, final_assembly_id: id, sort_order: i }))
      await supabaseAdmin.from('bom_final_assembly_components').insert(comps)
    }
  }

  await recalculateCascade('final_assembly', id)
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('bom_final_assemblies').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
