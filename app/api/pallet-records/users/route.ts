import { NextResponse } from 'next/server'
import { adminOnly, forbidden } from '@/lib/pallets/api'
import { palletActorFromRequest } from '@/lib/pallets/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const APP_NAME = 'production'
const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'
const VALID_ROLES = new Set(['admin', 'user'])
const VALID_STATUSES = new Set(['active', 'pending', 'disabled'])

function isSuperAdminEmail(email: string | null | undefined) {
  return (email || '').toLowerCase() === SUPER_ADMIN_EMAIL
}

export async function GET(request: Request) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('app', APP_NAME)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ users: users || [] })
  } catch (error) {
    console.error('Users API error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { userId, role, status, name } = await request.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    if (role !== undefined && !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const { data: targetUser } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', userId)
      .eq('app', APP_NAME)
      .single()

    if (isSuperAdminEmail(targetUser?.email)) {
      return NextResponse.json({ error: 'Cannot modify super admin' }, { status: 403 })
    }

    const updates: Record<string, string> = { updated_at: new Date().toISOString() }
    if (role) updates.role = role
    if (status) updates.status = status
    if (name !== undefined) updates.name = name

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId)
      .eq('app', APP_NAME)

    if (updateError) throw updateError
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Users PUT error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const actor = await palletActorFromRequest(request)
  if (!actor.canView) return forbidden()
  if (!actor.isAdmin) return adminOnly()

  try {
    const { email, name, role = 'user', status = 'active' } = await request.json()
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
    }
    if (!VALID_ROLES.has(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const cleanEmail = email.toLowerCase().trim()
    if (isSuperAdminEmail(cleanEmail)) {
      return NextResponse.json({ error: 'Cannot modify super admin' }, { status: 403 })
    }

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('row_id, email')
      .eq('email', cleanEmail)
      .eq('app', APP_NAME)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    const listResp = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    })

    let authUserId: string | null = null
    if (listResp.ok) {
      const listData = await listResp.json()
      const existingAuth = listData.users?.find((u: { email: string }) => u.email === cleanEmail)
      if (existingAuth) authUserId = existingAuth.id
    }

    if (!authUserId) {
      const authResp = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: cleanEmail,
          email_confirm: false,
          user_metadata: { pre_registered: true, display_name: name || cleanEmail.split('@')[0] },
        }),
      })

      if (!authResp.ok) {
        const authErr = await authResp.json()
        console.error('Auth user creation error:', authErr)
        return NextResponse.json({ error: authErr.msg || authErr.message || 'Failed to create auth user' }, { status: 500 })
      }

      const authUser = await authResp.json()
      authUserId = authUser.id
    }

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: authUserId,
        email: cleanEmail,
        name: name || cleanEmail.split('@')[0],
        role,
        status,
        app: APP_NAME,
      })
      .select()
      .single()

    if (insertError) {
      console.error('Pre-register error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ user: newUser })
  } catch (error) {
    console.error('Users POST error:', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
