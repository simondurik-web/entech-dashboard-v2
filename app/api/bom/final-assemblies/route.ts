import { NextResponse } from 'next/server'
import { BomAuthoringError, createFinalAssembly } from '@/lib/bom-authoring'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('bom_final_assemblies')
    .select('*, bom_final_assembly_components(*)')
    .order('part_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const data = await createFinalAssembly(body)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof BomAuthoringError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to create final assembly.' }, { status: 500 })
  }
}
