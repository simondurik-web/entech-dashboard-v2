import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Note: Auth is enforced client-side via AccessGuard (consistent with all BOM API routes).
// Server-side auth for BOM routes is tracked as a future improvement.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid item ID format' }, { status: 400 })
  }

  let body: { lead_time: number | null; _performed_by_name?: string; _performed_by_email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { lead_time } = body
  const performedByName = body._performed_by_name || null
  const performedByEmail = body._performed_by_email || null

  // Validation: must be positive integer or null
  if (lead_time !== null) {
    if (typeof lead_time !== 'number' || !Number.isInteger(lead_time) || lead_time <= 0) {
      return NextResponse.json(
        { error: 'lead_time must be a positive integer or null' },
        { status: 400 }
      )
    }
  }

  // Fetch existing for audit diff
  const { data: existing } = await supabaseAdmin
    .from('bom_individual_items')
    .select('id, lead_time, part_number')
    .eq('id', id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const { data, error } = await supabaseAdmin
    .from('bom_individual_items')
    .update({ lead_time, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, lead_time')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Audit trail for lead_time change
  const oldVal = existing.lead_time != null ? String(existing.lead_time) : null
  const newVal = lead_time != null ? String(lead_time) : null
  if (oldVal !== newVal) {
    await supabaseAdmin.from('bom_audit').insert({
      entity_type: 'individual_item',
      entity_id: id,
      action: 'updated',
      field_name: 'lead_time',
      old_value: oldVal,
      new_value: newVal,
      performed_by_name: performedByName,
      performed_by_email: performedByEmail,
    })
  }

  return NextResponse.json({ success: true, lead_time: data.lead_time })
}
