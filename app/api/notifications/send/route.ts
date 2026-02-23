import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Lazy-load web-push to avoid build issues
let webpush: typeof import('web-push') | null = null
async function getWebPush() {
  if (!webpush) {
    webpush = await import('web-push')
    webpush.setVapidDetails(
      'mailto:simon.durik@4entech.com',
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
      process.env.VAPID_PRIVATE_KEY || ''
    )
  }
  return webpush
}

export async function POST(req: NextRequest) {
  try {
    const { title, body, url, targetRole, targetUserId, sentBy } = await req.json()
    if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })

    // Get target subscriptions
    let query = supabaseAdmin.from('push_subscriptions').select('*')
    if (targetUserId) {
      query = query.eq('user_id', targetUserId)
    } else if (targetRole) {
      // Get user IDs with this role
      const { data: users } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('role', targetRole)
        .eq('is_active', true)
      if (users?.length) {
        query = query.in('user_id', users.map(u => u.id))
      } else {
        return NextResponse.json({ sent: 0 })
      }
    }

    const { data: subs, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!subs?.length) return NextResponse.json({ sent: 0 })

    const wp = await getWebPush()
    const payload = JSON.stringify({ title, body, url: url || '/', tag: `entech-${Date.now()}` })

    let sent = 0
    const stale: string[] = []

    for (const sub of subs) {
      try {
        await wp.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        )
        sent++
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 410 || statusCode === 404) {
          stale.push(sub.id)
        }
      }
    }

    // Clean up stale subscriptions
    if (stale.length) {
      await supabaseAdmin.from('push_subscriptions').delete().in('id', stale)
    }

    // Log notification
    await supabaseAdmin.from('notification_log').insert({
      title,
      body,
      sent_by: sentBy || null,
      target_role: targetRole || null,
      target_user_id: targetUserId || null,
      sent_count: sent,
    })

    return NextResponse.json({ sent, total: subs.length, staleRemoved: stale.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
