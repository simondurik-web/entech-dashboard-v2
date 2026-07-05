import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateAssignedTo } from '@/lib/google-sheets-write'
import { requirePermission } from '@/lib/require-user'

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
  if (!(await requirePermission(req, 'assign_orders'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json()
  const { line, assigned_to } = body as { line: string; assigned_to: string }

  if (!line) {
    return NextResponse.json({ error: 'line is required' }, { status: 400 })
  }

  // 1. Update Supabase (source of truth the dashboard reads)
  const { error: dbError } = await supabaseAdmin
    .from('dashboard_orders')
    .update({ assigned_to: assigned_to || null })
    .eq('line', line)

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  // 2. Mirror to the legacy Google Sheet best-effort. Post-ERPNext-cutover the sheet is no longer the
  //    data source, so a missing/legacy line (or absent creds) must NOT block assignment. This matches
  //    PUT/DELETE below and the PR #200 fix; the old hard 500-gate here silently blocked every
  //    assignment on ERPNext-synced lines that don't exist in the retired sheet.
  updateAssignedTo(line, assigned_to || '').catch(() => {})

  return NextResponse.json({ ok: true, line, assigned_to })
}

/** PUT — Rename an assignee across ALL orders (both Supabase & Google Sheets) */
export async function PUT(req: NextRequest) {
  if (!(await requirePermission(req, 'assign_orders'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { old_name, new_name } = (await req.json()) as { old_name: string; new_name: string }
  if (!old_name || !new_name) {
    return NextResponse.json({ error: 'old_name and new_name are required' }, { status: 400 })
  }

  // Find all orders with this assignee
  const { data: orders } = await supabaseAdmin
    .from('dashboard_orders')
    .select('line')
    .eq('assigned_to', old_name)

  const lines = (orders || []).map(o => String(o.line))

  // Update Supabase in bulk
  const { error: dbError } = await supabaseAdmin
    .from('dashboard_orders')
    .update({ assigned_to: new_name })
    .eq('assigned_to', old_name)

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  // Update Google Sheets for each order (in background — don't block the response)
  for (const line of lines) {
    updateAssignedTo(line, new_name).catch(() => {})
  }

  return NextResponse.json({ ok: true, renamed: lines.length, old_name, new_name })
}

/** DELETE — Remove an assignee (unassign all their orders) */
export async function DELETE(req: NextRequest) {
  if (!(await requirePermission(req, 'assign_orders'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name } = (await req.json()) as { name: string }
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Find all orders with this assignee
  const { data: orders } = await supabaseAdmin
    .from('dashboard_orders')
    .select('line')
    .eq('assigned_to', name)

  const lines = (orders || []).map(o => String(o.line))

  // Clear in Supabase
  const { error: dbError } = await supabaseAdmin
    .from('dashboard_orders')
    .update({ assigned_to: null })
    .eq('assigned_to', name)

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  // Clear in Google Sheets
  for (const line of lines) {
    updateAssignedTo(line, '').catch(() => {})
  }

  return NextResponse.json({ ok: true, unassigned: lines.length, name })
}
