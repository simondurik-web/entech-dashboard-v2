import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // Fetch the original
    const { data: original, error: fetchError } = await supabaseAdmin
      .from('customer_part_mappings')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
    }

    // Clone it (remove id, timestamps)
    const { id: _id, created_at: _ca, updated_at: _ua, ...clone } = original

    const { data, error } = await supabaseAdmin
      .from('customer_part_mappings')
      .insert(clone)
      .select('*, customers(name, payment_terms)')
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to duplicate mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
