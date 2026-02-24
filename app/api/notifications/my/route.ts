import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET: Fetch recent notifications (last 50)
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const notifications = (data || []).map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      sentBy: n.sent_by,
      targetRole: n.target_role,
      targetUserId: n.target_user_id,
      sentCount: n.sent_count,
      createdAt: n.created_at,
      isAuto: n.target_role === 'auto',
    }))

    return NextResponse.json({ notifications })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
