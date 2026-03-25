import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mappingId = searchParams.get('mapping_id')
    const performedBy = searchParams.get('performed_by')
    const action = searchParams.get('action')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabaseAdmin
      .from('customer_part_mapping_audit')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (mappingId) query = query.eq('mapping_id', mappingId)
    if (performedBy) query = query.ilike('performed_by_name', `%${performedBy}%`)
    if (action) query = query.eq('action', action)

    const { data, error, count } = await query

    if (error) throw error
    return NextResponse.json({ entries: data || [], total: count || 0 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch audit log'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
