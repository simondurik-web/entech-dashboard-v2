import { NextRequest, NextResponse } from 'next/server'
import {
  buildCustomerPartMappingCosts,
  CustomerPartMappingValidationError,
} from '@/lib/customer-part-mapping-costs'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Fields to track in audit trail
const AUDIT_FIELDS = [
  'customer_id', 'customer_part_number', 'internal_part_number',
  'category', 'packaging', 'package_quantity',
  'tier1_range', 'tier1_price', 'tier2_range', 'tier2_price',
  'tier3_range', 'tier3_price', 'tier4_range', 'tier4_price',
  'tier5_range', 'tier5_price', 'notes',
]

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    // Fetch existing record for audit diff
    const { data: existing } = await supabaseAdmin
      .from('customer_part_mappings')
      .select('*')
      .eq('id', id)
      .single()

    const performedByName = body._performed_by_name || 'Unknown'
    const performedByEmail = body._performed_by_email || ''
    delete body._performed_by_name
    delete body._performed_by_email

    const mappingCosts = await buildCustomerPartMappingCosts(body)

    body.internal_part_number = mappingCosts.internal_part_number
    body.lowest_quoted_price = mappingCosts.lowest_quoted_price
    body.variable_cost = mappingCosts.variable_cost
    body.total_cost = mappingCosts.total_cost
    body.sales_target = mappingCosts.sales_target
    body.contribution_level = mappingCosts.contribution_level

    body.updated_at = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('customer_part_mappings')
      .update(body)
      .eq('id', id)
      .select('*, customers(name, payment_terms)')
      .single()

    if (error) throw error

    // Record audit entries for changed fields
    if (existing) {
      const auditEntries: Array<{
        mapping_id: string
        action: string
        field_name: string
        old_value: string | null
        new_value: string | null
        performed_by_name: string
        performed_by_email: string
      }> = []

      for (const field of AUDIT_FIELDS) {
        const oldVal = String(existing[field] ?? '')
        const newVal = String(body[field] ?? '')
        if (oldVal !== newVal) {
          auditEntries.push({
            mapping_id: id,
            action: 'updated',
            field_name: field,
            old_value: existing[field] != null ? String(existing[field]) : null,
            new_value: body[field] != null ? String(body[field]) : null,
            performed_by_name: performedByName,
            performed_by_email: performedByEmail,
          })
        }
      }

      if (auditEntries.length > 0) {
        await supabaseAdmin.from('customer_part_mapping_audit').insert(auditEntries)
      }
    }

    return NextResponse.json(data)
  } catch (err: unknown) {
    if (err instanceof CustomerPartMappingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : 'Failed to update mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fetch the record before deleting (for audit)
    const { data: existing } = await supabaseAdmin
      .from('customer_part_mappings')
      .select('*, customers(name)')
      .eq('id', id)
      .single()

    // Parse optional body for who performed the delete
    let deletedByName = 'Unknown'
    let deletedByEmail = ''
    try {
      const body = await req.json()
      if (body.deleted_by_name) deletedByName = body.deleted_by_name
      if (body.deleted_by_email) deletedByEmail = body.deleted_by_email
    } catch { /* no body is fine */ }

    const { error } = await supabaseAdmin
      .from('customer_part_mappings')
      .delete()
      .eq('id', id)

    if (error) throw error

    // Record audit entry
    if (existing) {
      const description = `${existing.customers?.name || 'Unknown'} / ${existing.internal_part_number}`
      await supabaseAdmin.from('customer_part_mapping_audit').insert({
        mapping_id: id,
        action: 'deleted',
        field_name: null,
        old_value: description,
        new_value: null,
        performed_by_name: deletedByName,
        performed_by_email: deletedByEmail,
      })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
