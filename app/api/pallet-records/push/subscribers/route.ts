import { NextRequest, NextResponse } from 'next/server'
import { adminOnly, forbidden, pushConfigured } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(request: NextRequest) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { data: subs, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('user_email, user_name, created_at')
      .eq('app', 'production')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const grouped = new Map<string, { email: string; name: string | null; devices: number; latest: string }>()
    for (const sub of subs || []) {
      const existing = grouped.get(sub.user_email)
      if (existing) {
        existing.devices++
        if (sub.created_at > existing.latest) existing.latest = sub.created_at
      } else {
        grouped.set(sub.user_email, {
          email: sub.user_email,
          name: sub.user_name,
          devices: 1,
          latest: sub.created_at,
        })
      }
    }

    return NextResponse.json({
      configured: pushConfigured(),
      subscribers: Array.from(grouped.values()),
    })
  } catch (err) {
    console.error('Subscribers error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
