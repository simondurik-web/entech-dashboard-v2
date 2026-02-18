import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const customerId = searchParams.get('customer_id')
    const search = searchParams.get('search')
    const contributionLevel = searchParams.get('contribution_level')

    let query = supabaseAdmin
      .from('customer_part_mappings')
      .select('*, customers(name, payment_terms)')
      .order('created_at', { ascending: false })

    if (customerId) query = query.eq('customer_id', customerId)
    if (contributionLevel) query = query.eq('contribution_level', contributionLevel)
    if (search) {
      query = query.or(
        `internal_part_number.ilike.%${search}%,customer_part_number.ilike.%${search}%`
      )
    }

    const { data, error } = await query
    if (error) throw error
    return NextResponse.json(data || [])
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch mappings'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      customer_id, customer_part_number, internal_part_number,
      category, packaging, package_quantity,
      tier1_range, tier1_price, tier2_range, tier2_price,
      tier3_range, tier3_price, tier4_range, tier4_price,
      tier5_range, tier5_price, notes,
    } = body

    if (!customer_id || !internal_part_number) {
      return NextResponse.json(
        { error: 'customer_id and internal_part_number are required' },
        { status: 400 }
      )
    }

    // Compute lowest price
    const prices = [tier1_price, tier2_price, tier3_price, tier4_price, tier5_price]
      .filter((p) => p != null && p > 0)
    const lowest_quoted_price = prices.length > 0 ? Math.min(...prices) : null

    const { data, error } = await supabaseAdmin
      .from('customer_part_mappings')
      .insert({
        customer_id, customer_part_number, internal_part_number,
        category, packaging, package_quantity,
        tier1_range, tier1_price, tier2_range, tier2_price,
        tier3_range, tier3_price, tier4_range, tier4_price,
        tier5_range, tier5_price, notes, lowest_quoted_price,
      })
      .select('*, customers(name, payment_terms)')
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
