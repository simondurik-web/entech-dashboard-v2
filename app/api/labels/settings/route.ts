import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const SUPER_ADMIN_EMAIL = 'simondurik@gmail.com'

async function isAdmin(req: NextRequest): Promise<boolean> {
  const userId = req.headers.get('x-user-id')
  if (!userId) return false
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role, email')
    .eq('id', userId)
    .single()
  if (profile?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return true
  return profile?.role === 'admin'
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('label_settings')
    .select('*')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Convert to key-value map
  const settings: Record<string, string> = {}
  for (const row of data ?? []) {
    settings[row.setting_key] = row.setting_value
  }

  return NextResponse.json(settings)
}

export async function PUT(req: NextRequest) {
  if (!(await isAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { setting_key, setting_value } = body
  const userId = req.headers.get('x-user-id')

  if (!setting_key || setting_value === undefined) {
    return NextResponse.json({ error: 'Missing setting_key or setting_value' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('label_settings')
    .update({
      setting_value: String(setting_value),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('setting_key', setting_key)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
