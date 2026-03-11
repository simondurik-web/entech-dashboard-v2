import { NextRequest, NextResponse } from 'next/server'
import {
  buildCustomerPartMappingCosts,
  CustomerPartMappingValidationError,
} from '@/lib/customer-part-mapping-costs'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // Fetch the original
    const { data: original, error: fetchError } = await supabaseAdmin
      .from('customer_part_mappings')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !original) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
    }

    // Clone it without carrying over record identity fields.
    const clone = {
      ...original,
    }
    delete clone.id
    delete clone.created_at
    delete clone.updated_at
    const mappingCosts = await buildCustomerPartMappingCosts(clone)

    const { data, error } = await supabaseAdmin
      .from('customer_part_mappings')
      .insert({
        ...clone,
        ...mappingCosts,
      })
      .select('*, customers(name, payment_terms)')
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof CustomerPartMappingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : 'Failed to duplicate mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
