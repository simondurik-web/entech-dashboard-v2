import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { adminOnly, forbidden, pushConfigured, pushNotConfigured } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

function initWebPush() {
  webpush.setVapidDetails(
    'mailto:simon.durik@4entech.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
}

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()
  if (!pushConfigured()) return pushNotConfigured()

  try {
    initWebPush()
    const { email, title, body, url } = await request.json()
    if (!title || !body) {
      return NextResponse.json({ error: 'Title and body required' }, { status: 400 })
    }

    let query = supabaseAdmin
      .from('push_subscriptions')
      .select('*')
      .eq('app', 'production')

    if (email) query = query.eq('user_email', email)

    const { data: subscriptions, error: fetchError } = await query
    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: 'No subscriptions found' })
    }

    const payload = JSON.stringify({ title, body, url })
    let sent = 0
    let failed = 0
    const staleEndpoints: string[] = []

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
            },
            payload
          )
          sent++
        } catch (err: unknown) {
          failed++
          const statusCode = (err as { statusCode?: number })?.statusCode
          if (statusCode === 404 || statusCode === 410) staleEndpoints.push(sub.endpoint)
        }
      })
    )

    if (staleEndpoints.length > 0) {
      await supabaseAdmin
        .from('push_subscriptions')
        .delete()
        .in('endpoint', staleEndpoints)
    }

    return NextResponse.json({ sent, failed, cleaned: staleEndpoints.length })
  } catch (err) {
    console.error('Notify error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
