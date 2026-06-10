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
      .select('id, user_id, created_at')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const userIds = Array.from(new Set((subs || []).map((sub) => sub.user_id).filter(Boolean)))
    const { data: profiles, error: profilesError } = userIds.length
      ? await supabaseAdmin
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds)
      : { data: [], error: null }

    if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 })

    const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]))
    const grouped = new Map<string, { user_id: string; email: string; full_name: string | null; devices: number; latest: string }>()
    for (const sub of subs || []) {
      const profile = profilesById.get(sub.user_id)
      const email = profile?.email || sub.user_id
      const existing = grouped.get(sub.user_id)
      if (existing) {
        existing.devices++
        if (sub.created_at > existing.latest) existing.latest = sub.created_at
      } else {
        grouped.set(sub.user_id, {
          user_id: sub.user_id,
          email,
          full_name: profile?.full_name || null,
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
