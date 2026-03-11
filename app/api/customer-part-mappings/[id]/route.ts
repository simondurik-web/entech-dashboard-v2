import { NextRequest, NextResponse } from 'next/server'
import {
  buildCustomerPartMappingCosts,
  CustomerPartMappingValidationError,
} from '@/lib/customer-part-mapping-costs'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { error } = await supabaseAdmin
      .from('customer_part_mappings')
      .delete()
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
