import { NextResponse } from 'next/server'
import { BomAuthoringError, createSubAssembly } from '@/lib/bom-authoring'
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
  try {
    const body = await req.json()
    const data = await createSubAssembly(body)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof BomAuthoringError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to create sub-assembly.' }, { status: 500 })
  }
}
