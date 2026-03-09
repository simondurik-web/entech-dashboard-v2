import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if admin (app-specific role)
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('email')
    .eq('id', userId)
    .single()

  const { data: appRole } = await supabaseAdmin
    .from('user_app_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('app_id', 'dashboard')
    .single()

  const effectiveRole = appRole?.role || 'visitor'
  if (!profile || (effectiveRole !== 'admin' && profile.email?.toLowerCase() !== 'simondurik@gmail.com')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: logs } = await supabaseAdmin
    .from('notification_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  return NextResponse.json({ logs: logs ?? [] })
}
