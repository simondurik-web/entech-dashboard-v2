import { NextRequest, NextResponse } from 'next/server'
import { adminOnly, forbidden, pushConfigured, pushNotConfigured } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

let webpush: typeof import('web-push') | null = null
async function getWebPush() {
  if (!webpush) {
    webpush = await import('web-push')
  }
  webpush.setVapidDetails(
    'mailto:simon.durik@4entech.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
  return webpush
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()
  if (!pushConfigured()) return pushNotConfigured()

  try {
    const wp = await getWebPush()
    const { user_id, targetUserId, email, title, body, url } = await request.json()
    if (!title || !body) {
      return NextResponse.json({ error: 'Title and body required' }, { status: 400 })
    }

    let targetUser = user_id || targetUserId || null
    if (!targetUser && email) {
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('id')
        .eq('email', String(email).toLowerCase())
        .maybeSingle()
      targetUser = profile?.id || null
    }

    let query = supabaseAdmin
      .from('push_subscriptions')
      .select('*')

    if (targetUser) query = query.eq('user_id', targetUser)

    const { data: subscriptions, error: fetchError } = await query
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: 'No subscriptions found' })
    }

    const payload = JSON.stringify({ title, body, url })
    let sent = 0
    let failed = 0
    const staleIds: string[] = []

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
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
          failed++
          const statusCode = (err as { statusCode?: number })?.statusCode
          if (statusCode === 404 || statusCode === 410) staleIds.push(sub.id)
        }
      })
    )

    if (staleIds.length > 0) {
      await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .in('id', staleIds)
    }

    return NextResponse.json({ sent, failed, cleaned: staleIds.length })
  } catch (err) {
    console.error('Notify error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
