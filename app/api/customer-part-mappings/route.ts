import { NextRequest, NextResponse } from 'next/server'
import {
  buildCustomerPartMappingCosts,
  CustomerPartMappingValidationError,
} from '@/lib/customer-part-mapping-costs'
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

    // Enrich mappings with LIVE BOM costs (stored costs are stale after BOM edits)
    if (data && data.length > 0) {
      const partNumbers = [...new Set(data.map((m: { internal_part_number: string }) => m.internal_part_number).filter(Boolean))]
      const { data: bomData } = await supabaseAdmin
        .from('bom_final_assemblies')
        .select('part_number, variable_cost, total_cost, sales_target')
        .in('part_number', partNumbers)

      if (bomData) {
        const bomLookup = new Map(bomData.map((b: { part_number: string; variable_cost: number; total_cost: number; sales_target: number }) => [b.part_number, b]))
        for (const mapping of data) {
          const bom = bomLookup.get(mapping.internal_part_number)
          if (bom) {
            mapping.variable_cost = bom.variable_cost
            mapping.total_cost = bom.total_cost
            mapping.sales_target = bom.sales_target

            // Recompute contribution level with live costs
            const prices = [mapping.tier1_price, mapping.tier2_price, mapping.tier3_price, mapping.tier4_price, mapping.tier5_price]
              .filter((p: number | null) => p != null && p > 0)
            const lowest = prices.length > 0 ? Math.min(...prices) : mapping.lowest_quoted_price

            if (lowest && bom.variable_cost && bom.total_cost && bom.sales_target) {
              if (lowest < bom.variable_cost) mapping.contribution_level = 'Critical Loss'
              else if (lowest < bom.total_cost) mapping.contribution_level = 'Marginal Coverage'
              else if (lowest < bom.sales_target) mapping.contribution_level = 'Net Profitable'
              else mapping.contribution_level = 'Target Achieved'
            }
          }
        }
      }
    }

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
      customer_id, customer_part_number,
      category, packaging, package_quantity,
      tier1_range, tier1_price, tier2_range, tier2_price,
      tier3_range, tier3_price, tier4_range, tier4_price,
      tier5_range, tier5_price, notes,
    } = body

    const mappingCosts = await buildCustomerPartMappingCosts(body)
    const { internal_part_number, lowest_quoted_price, variable_cost, total_cost, sales_target, contribution_level } = mappingCosts

    if (!customer_id || !internal_part_number) {
      return NextResponse.json(
        { error: 'customer_id and internal_part_number are required' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('customer_part_mappings')
      .insert({
        customer_id, customer_part_number, internal_part_number,
        category, packaging, package_quantity,
        tier1_range, tier1_price, tier2_range, tier2_price,
        tier3_range, tier3_price, tier4_range, tier4_price,
        tier5_range, tier5_price, notes, lowest_quoted_price,
        variable_cost, total_cost, sales_target, contribution_level,
      })
      .select('*, customers(name, payment_terms)')
      .single()

    if (error) throw error
    return NextResponse.json(data, { status: 201 })
  } catch (err: unknown) {
    if (err instanceof CustomerPartMappingValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : 'Failed to create mapping'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
