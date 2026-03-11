import { computeContributionLevel } from '@/lib/cost-config'
import { supabaseAdmin } from '@/lib/supabase-admin'

type MappingPriceInput = {
  tier1_price?: number | null
  tier2_price?: number | null
  tier3_price?: number | null
  tier4_price?: number | null
  tier5_price?: number | null
}

type MappingCostFields = {
  internal_part_number: string
  lowest_quoted_price: number | null
  variable_cost: number | null
  total_cost: number | null
  sales_target: number | null
  contribution_level: ReturnType<typeof computeContributionLevel>
}

type BomCostFields = {
  variable_cost: number | null
  total_cost: number | null
  sales_target: number | null
}

export function normalizeInternalPartNumber(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function computeLowestQuotedPrice(input: MappingPriceInput): number | null {
  const prices = [
    input.tier1_price,
    input.tier2_price,
    input.tier3_price,
    input.tier4_price,
    input.tier5_price,
  ].filter((price): price is number => price != null && price > 0)

  return prices.length > 0 ? Math.min(...prices) : null
}

async function fetchBomCostFields(partNumber: string): Promise<BomCostFields> {
  if (!partNumber) {
    return {
      variable_cost: null,
      total_cost: null,
      sales_target: null,
    }
  }

  const { data } = await supabaseAdmin
    .from('bom_final_assemblies')
    .select('part_number, variable_cost, total_cost, sales_target')
    .eq('part_number', partNumber)
    .maybeSingle()

  if (!data) {
    return {
      variable_cost: null,
      total_cost: null,
      sales_target: null,
    }
  }

  return {
    variable_cost: data.variable_cost,
    total_cost: data.total_cost,
    sales_target: data.sales_target,
  }
}

export async function buildCustomerPartMappingCosts(
  input: MappingPriceInput & { internal_part_number?: unknown }
): Promise<MappingCostFields> {
  const internal_part_number = normalizeInternalPartNumber(input.internal_part_number)
  const lowest_quoted_price = computeLowestQuotedPrice(input)
  const bomCosts = await fetchBomCostFields(internal_part_number)

  return {
    internal_part_number,
    lowest_quoted_price,
    variable_cost: bomCosts.variable_cost,
    total_cost: bomCosts.total_cost,
    sales_target: bomCosts.sales_target,
    contribution_level: computeContributionLevel(
      lowest_quoted_price,
      bomCosts.variable_cost,
      bomCosts.total_cost,
      bomCosts.sales_target
    ),
  }
}
