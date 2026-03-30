import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entityType = searchParams.get('entity_type')
    const entityId = searchParams.get('entity_id')
    const action = searchParams.get('action')
    const performedBy = searchParams.get('performed_by')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabaseAdmin
      .from('bom_audit')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (entityType) query = query.eq('entity_type', entityType)
    if (entityId) query = query.eq('entity_id', entityId)
    if (action) query = query.eq('action', action)
    if (performedBy) query = query.ilike('performed_by_name', `%${performedBy}%`)

    const { data, error, count } = await query

    if (error) throw error
    return NextResponse.json({ entries: data || [], total: count || 0 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch BOM audit log'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
