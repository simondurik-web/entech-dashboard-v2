import { NextResponse } from 'next/server'
import { BomAuthoringError, updateFinalAssembly } from '@/lib/bom-authoring'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { attributeCostHistory } from '@/lib/bom-cost-history-attribution'

const AUDIT_FIELDS = [
  'part_number', 'product_category', 'sub_product_category', 'description', 'notes',
  'parts_per_package', 'parts_per_hour', 'labor_rate_per_hour', 'num_employees',
  'shipping_labor_cost', 'overhead_pct', 'admin_pct', 'depreciation_pct', 'repairs_pct', 'profit_target_pct',
]

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const performedByName = body._performed_by_name || null
    const performedByEmail = body._performed_by_email || null
    delete body._performed_by_name
    delete body._performed_by_email

    const requestStart = new Date().toISOString()

    // Fetch existing for audit diff
    const { data: existing } = await supabaseAdmin
      .from('bom_final_assemblies')
      .select('*')
      .eq('id', id)
      .single()

    const data = await updateFinalAssembly(id, body)
    await attributeCostHistory(requestStart, performedByEmail, performedByName)

    // Audit trail
    if (existing) {
      const auditEntries: Array<Record<string, unknown>> = []
      for (const field of AUDIT_FIELDS) {
        if (field in body) {
          const oldVal = String(existing[field] ?? '')
          const newVal = String(body[field] ?? '')
          if (oldVal !== newVal) {
            auditEntries.push({
              entity_type: 'final_assembly',
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

    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof BomAuthoringError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    return NextResponse.json({ error: 'Failed to update final assembly.' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { data: existing } = await supabaseAdmin
    .from('bom_final_assemblies')
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

  const { error } = await supabaseAdmin.from('bom_final_assemblies').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing) {
    await supabaseAdmin.from('bom_audit').insert({
      entity_type: 'final_assembly',
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
