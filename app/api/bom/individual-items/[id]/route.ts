import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { recalculateCascade } from '@/lib/bom-recalculate'

const AUDIT_FIELDS = ['part_number', 'description', 'cost_per_unit', 'unit', 'supplier']

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const performedByName = body._performed_by_name || null
  const performedByEmail = body._performed_by_email || null
  delete body._performed_by_name
  delete body._performed_by_email

  // Fetch existing for audit diff
  const { data: existing } = await supabaseAdmin
    .from('bom_individual_items')
    .select('*')
    .eq('id', id)
    .single()

  body.updated_at = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('bom_individual_items')
    .update(body)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Audit trail
  if (existing) {
    const auditEntries: Array<Record<string, unknown>> = []
    for (const field of AUDIT_FIELDS) {
      if (field in body) {
        const oldVal = String(existing[field] ?? '')
        const newVal = String(body[field] ?? '')
        if (oldVal !== newVal) {
          auditEntries.push({
            entity_type: 'individual_item',
            entity_id: id,
            action: 'updated',
            field_name: field,
            old_value: existing[field] != null ? String(existing[field]) : null,
            new_value: body[field] != null ? String(body[field]) : null,
            performed_by_name: performedByName,
            performed_by_email: performedByEmail,
          })
        }
      }
    }
    if (auditEntries.length > 0) {
      await supabaseAdmin.from('bom_audit').insert(auditEntries)
    }
  }

  // Cascade recalculation
  await recalculateCascade('individual_item', id)

  return NextResponse.json(data)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Fetch for audit
  const { data: existing } = await supabaseAdmin
    .from('bom_individual_items')
    .select('*')
    .eq('id', id)
    .single()

  let performedByName: string | null = null
  let performedByEmail: string | null = null
  try {
    const body = await req.json()
    performedByName = body._performed_by_name || null
    performedByEmail = body._performed_by_email || null
  } catch { /* no body is fine */ }

  const { error } = await supabaseAdmin.from('bom_individual_items').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing) {
    await supabaseAdmin.from('bom_audit').insert({
      entity_type: 'individual_item',
      entity_id: id,
      action: 'deleted',
      field_name: null,
      old_value: existing.part_number,
      new_value: null,
      performed_by_name: performedByName,
      performed_by_email: performedByEmail,
    })
  }

  return NextResponse.json({ success: true })
}
