import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    // Compute lowest price
    const prices = [body.tier1_price, body.tier2_price, body.tier3_price, body.tier4_price, body.tier5_price]
      .filter((p) => p != null && p > 0)
    body.lowest_quoted_price = prices.length > 0 ? Math.min(...prices) : null

    // Auto-populate costs from BOM if internal_part_number is present
    if (body.internal_part_number) {
      const { data: bomData } = await supabaseAdmin
        .from('bom_final_assemblies')
        .select('variable_cost, total_cost, sales_target')
        .eq('part_number', body.internal_part_number)
        .single()

      if (bomData) {
        body.variable_cost = bomData.variable_cost
        body.total_cost = bomData.total_cost
        body.sales_target = bomData.sales_target
      }
    }

    // Recompute contribution level if we have cost data
    if (body.variable_cost && body.total_cost && body.sales_target && body.lowest_quoted_price) {
      const lp = body.lowest_quoted_price
      if (lp < body.variable_cost) body.contribution_level = 'Critical Loss'
      else if (lp < body.total_cost) body.contribution_level = 'Marginal Coverage'
      else if (lp < body.sales_target) body.contribution_level = 'Net Profitable'
      else body.contribution_level = 'Target Achieved'
    }

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
