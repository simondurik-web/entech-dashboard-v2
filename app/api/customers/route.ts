import { NextResponse } from 'next/server'
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
