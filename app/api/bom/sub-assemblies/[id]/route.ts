import { NextResponse } from 'next/server'
import { BomAuthoringError, updateSubAssembly } from '@/lib/bom-authoring'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const data = await updateSubAssembly(id, body)
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof BomAuthoringError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to update sub-assembly.' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('bom_sub_assemblies').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
