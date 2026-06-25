import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUserOrDevice } from '@/lib/require-user'

export async function POST(req: NextRequest) {
  const actor = await requireUserOrDevice(req)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { endpoint, p256dh, auth } = await req.json()
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    // Bind the subscription to the VERIFIED caller, not a body-supplied userId
    // (which would let one user register a push sub under another's identity).
    const userId = actor.id

    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .upsert(
        { user_id: userId, endpoint, p256dh, auth },
        { onConflict: 'user_id,endpoint' }
      )

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const actor = await requireUserOrDevice(req)
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { endpoint } = await req.json()
    if (!endpoint) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }
    // Only let a caller remove THEIR OWN subscription (verified id, not body).
    await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('user_id', actor.id)
      .eq('endpoint', endpoint)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
