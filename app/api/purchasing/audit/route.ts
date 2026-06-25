import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireReadAccess } from '@/lib/require-user'

export const dynamic = 'force-dynamic'

/**
 * GET /api/purchasing/audit            -> recent audit entries (default 200)
 * GET /api/purchasing/audit?orderId=X  -> full history for one order
 */
export async function GET(req: NextRequest) {
  if (!(await requireReadAccess(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const orderId = searchParams.get('orderId')
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 1000)

  let query = supabaseAdmin
    .from('purchasing_audit')
    .select('*')
    .order('created_at', { ascending: false })

  if (orderId) query = query.eq('order_id', orderId)
  else query = query.limit(limit)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entries: data ?? [] })
}
