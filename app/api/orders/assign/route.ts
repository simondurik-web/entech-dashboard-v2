import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateAssignedTo } from '@/lib/google-sheets-write'

export async function GET() {
  // Return unique assignee names from dashboard_orders
  const { data, error } = await supabaseAdmin
    .from('dashboard_orders')
    .select('assigned_to')
    .not('assigned_to', 'is', null)
    .not('assigned_to', 'eq', '')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const names = [...new Set(
    (data || [])
      .map(r => String(r.assigned_to || '').trim())
      .filter(Boolean)
  )].sort()

  return NextResponse.json({ names })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { line, assigned_to } = body as { line: string; assigned_to: string }

  if (!line) {
    return NextResponse.json({ error: 'line is required' }, { status: 400 })
  }

  // 1. Update Google Sheets (source of truth)
  const sheetsResult = await updateAssignedTo(line, assigned_to || '')
  if (!sheetsResult.success) {
    return NextResponse.json(
      { error: `Sheets update failed: ${sheetsResult.error}` },
      { status: 500 }
    )
  }

  // 2. Update Supabase (immediate effect on dashboard)
  const { error: dbError } = await supabaseAdmin
    .from('dashboard_orders')
    .update({ assigned_to: assigned_to || null })
    .eq('line', line)

  if (dbError) {
    // Sheets succeeded but Supabase failed — next sync will fix it
    console.warn('Supabase update failed (Sheets succeeded, will sync):', dbError.message)
  }

  return NextResponse.json({ ok: true, line, assigned_to })
}
