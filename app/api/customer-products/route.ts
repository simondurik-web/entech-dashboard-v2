import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireReadAccess } from '@/lib/require-user'

export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { searchParams } = new URL(req.url)
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
