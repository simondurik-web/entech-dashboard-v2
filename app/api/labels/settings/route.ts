import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireUser, requireDashboardAccess, requireAdmin } from '@/lib/require-user'

// Gated 2026-07-27. Small payload, but it is label configuration and there is
// no reason for it to answer anonymous callers. Floor devices print labels, so
// this is device-aware rather than user-only.
export async function GET(req: NextRequest) {
  if (!(await requireDashboardAccess(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { setting_key, setting_value } = body
  const userId = (await requireUser(req))?.id

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
