import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('customers')
      .select('id, name, payment_terms, notes')
      .order('name')

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (err) {
    console.error('Failed to fetch customers:', err)
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, payment_terms, notes } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert({ name, payment_terms: payment_terms || 'Net 30', notes })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create customer'
    console.error('Failed to create customer:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
