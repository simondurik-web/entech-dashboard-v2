import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET: Fetch all notification rules
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_rules')
      .select('*')
      .eq('enabled', true)
      .order('event_type')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rules: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// POST: Set notification rules for an event type
// Body: { eventType: string, userIds: string[] }
export async function POST(req: NextRequest) {
  try {
    const { eventType, userIds } = await req.json()
    if (!eventType || !Array.isArray(userIds)) {
      return NextResponse.json({ error: 'eventType and userIds[] required' }, { status: 400 })
    }

    // Delete existing rules for this event type
    await supabaseAdmin
      .from('notification_rules')
      .delete()
      .eq('event_type', eventType)

    // Insert new rules
    if (userIds.length > 0) {
      const rows = userIds.map(uid => ({ event_type: eventType, user_id: uid, enabled: true }))
      const { error } = await supabaseAdmin.from('notification_rules').insert(rows)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, count: userIds.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
