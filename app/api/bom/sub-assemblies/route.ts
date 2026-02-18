import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .select('*, bom_sub_assembly_components(*)')
    .order('part_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const body = await req.json()
  const { components, ...assemblyData } = body
  const { data, error } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .insert(assemblyData)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  
  if (components?.length) {
    const comps = components.map((c: Record<string, unknown>, i: number) => ({ ...c, sub_assembly_id: data.id, sort_order: i }))
    await supabaseAdmin.from('bom_sub_assembly_components').insert(comps)
  }
  
  return NextResponse.json(data)
}
