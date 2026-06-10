import { NextRequest, NextResponse } from 'next/server'
import { actorId, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()

  try {
    const { subscription } = await request.json()
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        {
          user_id: actorId(actor),
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        { onConflict: 'user_id,endpoint' }
      )

    if (error) {
      console.error('Push subscribe error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Push subscribe error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
