import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customerId')
    
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('customer_part_mappings')
      .select('*')
      .eq('customer_id', customerId)
      .order('internal_part_number')

    if (error) throw error
    return NextResponse.json(data || [])
  } catch (err) {
    console.error('Failed to fetch customer products:', err)
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 })
  }
}
