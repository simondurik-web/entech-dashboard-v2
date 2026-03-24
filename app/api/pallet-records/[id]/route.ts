import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const userName = body.edited_by_name || 'Unknown'
  const userId = body.edited_by || null

  // Fetch current record for audit comparison
  const { data: current, error: fetchErr } = await supabaseAdmin
    .from('pallet_records')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    edited_at: new Date().toISOString(),
    edited_by_name: userName,
  }
  if (userId) updates.edited_by = userId

  // Track which fields changed for audit
  const auditEntries: { field_name: string; old_value: string; new_value: string }[] = []
  const fields = [
    { key: 'weight', label: 'Weight' },
    { key: 'length', label: 'Length' },
    { key: 'width', label: 'Width' },
    { key: 'height', label: 'Height' },
    { key: 'parts_per_pallet', label: 'Parts per Pallet' },
  ] as const

  for (const f of fields) {
    if (body[f.key] !== undefined) {
      const oldVal = String(current[f.key] ?? '')
      const newVal = String(body[f.key] ?? '')
      updates[f.key] = body[f.key]
      if (oldVal !== newVal) {
        auditEntries.push({
          field_name: f.label,
          old_value: oldVal || '(empty)',
          new_value: newVal || '(empty)',
        })
      }
    }
  }

  const { data, error } = await supabaseAdmin
    .from('pallet_records')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Write audit log entries
  if (auditEntries.length > 0) {
    await supabaseAdmin.from('pallet_record_audit').insert(
      auditEntries.map(e => ({
        pallet_record_id: id,
        action: 'edit',
        field_name: e.field_name,
        old_value: e.old_value,
        new_value: e.new_value,
        performed_by: userId,
        performed_by_name: userName,
      }))
    )
  }

  return NextResponse.json(data)
}

/** POST — Create a new pallet record for an order */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // id here is used as line_number for creating new pallet records
  const { id: lineNumber } = await params
  const body = await req.json()

  const { data, error } = await supabaseAdmin
    .from('pallet_records')
    .insert({
      line_number: lineNumber,
      order_id: body.order_id || null,
      pallet_number: body.pallet_number || 1,
      weight: body.weight || null,
      length: body.length || null,
      width: body.width || null,
      height: body.height || null,
      parts_per_pallet: body.parts_per_pallet || null,
      photo_urls: [],
      recorded_by: body.recorded_by || null,
      recorded_by_name: body.recorded_by_name || 'Manual entry',
      edited_by_name: body.recorded_by_name || null,
      edited_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit log
  await supabaseAdmin.from('pallet_record_audit').insert({
    pallet_record_id: data.id,
    action: 'created',
    field_name: null,
    old_value: null,
    new_value: `Pallet #${body.pallet_number || 1} created manually`,
    performed_by: body.recorded_by || null,
    performed_by_name: body.recorded_by_name || 'Manual entry',
  })

  return NextResponse.json(data)
}
