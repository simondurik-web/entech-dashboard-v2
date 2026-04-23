// Lightweight types and prefetch helpers used by the Customer Reference BOM
// expand panel. We keep a slim shape instead of re-exporting the full BOM page
// types — the expand panel only renders, never mutates.

export interface FinalAssemblyComponentLite {
  id: string
  component_part_number: string
  component_source: string
  quantity: number
  cost: number
  sort_order: number
}

export interface FinalAssemblyLite {
  id: string
  part_number: string
  description: string | null
  parts_per_hour: number | null
  labor_cost_per_part: number
  shipping_labor_cost: number
  subtotal_cost: number
  overhead_pct: number
  overhead_cost: number
  admin_pct: number
  admin_cost: number
  depreciation_pct: number
  depreciation_cost: number
  repairs_pct: number
  repairs_cost: number
  variable_cost: number
  total_cost: number
  profit_target_pct: number
  profit_amount: number
  sales_target: number
  components: FinalAssemblyComponentLite[]
}

export interface SubAssemblyComponentLite {
  id: string
  component_part_number: string
  quantity: number
  cost: number
  sort_order: number
}

export interface SubAssemblyLite {
  id: string
  part_number: string
  material_cost: number
  labor_cost_per_part: number
  overhead_cost: number
  total_cost: number
  components: SubAssemblyComponentLite[]
}

export interface IndividualItemLite {
  id: string
  part_number: string
  description: string | null
  cost_per_unit: number
  unit: string | null
  supplier: string | null
}

export type DrawingProductType = 'Tire' | 'Hub' | 'Other'

export interface DrawingLite {
  partNumber: string
  productType: DrawingProductType
  drawingUrl: string | null
}

/** Only allow http(s) URLs through — guards against `javascript:` from sheet-edited data. */
export function sanitizeDrawingUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = String(url).trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

export interface BomMaps {
  finalByPN: Map<string, FinalAssemblyLite>
  subByPN: Map<string, SubAssemblyLite>
  individualByPN: Map<string, IndividualItemLite>
  drawingsByPN: Map<string, DrawingLite>
}

const norm = (pn: string) => pn.trim().toUpperCase()

export function emptyBomMaps(): BomMaps {
  return {
    finalByPN: new Map(),
    subByPN: new Map(),
    individualByPN: new Map(),
    drawingsByPN: new Map(),
  }
}

interface FinalAssemblyApi {
  id: string
  part_number: string
  description: string | null
  parts_per_hour: number | null
  labor_cost_per_part: number
  shipping_labor_cost: number
  subtotal_cost: number
  overhead_pct: number
  overhead_cost: number
  admin_pct: number
  admin_cost: number
  depreciation_pct: number
  depreciation_cost: number
  repairs_pct: number
  repairs_cost: number
  variable_cost: number
  total_cost: number
  profit_target_pct: number
  profit_amount: number
  sales_target: number
  bom_final_assembly_components?: FinalAssemblyComponentLite[]
}

interface SubAssemblyApi {
  id: string
  part_number: string
  material_cost: number
  labor_cost_per_part: number
  overhead_cost: number
  total_cost: number
  bom_sub_assembly_components?: SubAssemblyComponentLite[]
}

interface IndividualItemApi {
  id: string
  part_number: string
  description: string | null
  cost_per_unit: number
  unit: string | null
  supplier: string | null
}

interface DrawingApi {
  partNumber: string
  productType?: DrawingProductType
  drawingUrls?: string[]
}

function coerceDrawingProductType(pt: unknown): DrawingProductType {
  if (pt === 'Tire' || pt === 'Hub') return pt
  return 'Other'
}

async function getJsonOrThrow<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return (await res.json()) as T
}

export async function fetchBomMaps(signal?: AbortSignal): Promise<BomMaps> {
  // Surface network / server failures to the caller so the Retry UI is reachable.
  // Using Promise.all means any one failing rejects the whole prefetch — the page
  // state switches to `errored` and the retry button re-invokes this function.
  const [finalRes, subRes, indivRes, drawingsRes] = await Promise.all([
    getJsonOrThrow<FinalAssemblyApi[]>('/api/bom/final-assemblies', signal),
    getJsonOrThrow<SubAssemblyApi[]>('/api/bom/sub-assemblies', signal),
    getJsonOrThrow<IndividualItemApi[]>('/api/bom/individual-items', signal),
    getJsonOrThrow<DrawingApi[]>('/api/drawings', signal),
  ])

  const maps = emptyBomMaps()

  for (const row of finalRes) {
    if (!row?.part_number) continue
    maps.finalByPN.set(norm(row.part_number), {
      id: row.id,
      part_number: row.part_number,
      description: row.description ?? null,
      parts_per_hour: row.parts_per_hour,
      labor_cost_per_part: row.labor_cost_per_part,
      shipping_labor_cost: row.shipping_labor_cost,
      subtotal_cost: row.subtotal_cost,
      overhead_pct: row.overhead_pct,
      overhead_cost: row.overhead_cost,
      admin_pct: row.admin_pct,
      admin_cost: row.admin_cost,
      depreciation_pct: row.depreciation_pct,
      depreciation_cost: row.depreciation_cost,
      repairs_pct: row.repairs_pct,
      repairs_cost: row.repairs_cost,
      variable_cost: row.variable_cost,
      total_cost: row.total_cost,
      profit_target_pct: row.profit_target_pct,
      profit_amount: row.profit_amount,
      sales_target: row.sales_target,
      components: row.bom_final_assembly_components ?? [],
    })
  }

  for (const row of subRes) {
    if (!row?.part_number) continue
    maps.subByPN.set(norm(row.part_number), {
      id: row.id,
      part_number: row.part_number,
      material_cost: row.material_cost,
      labor_cost_per_part: row.labor_cost_per_part,
      overhead_cost: row.overhead_cost,
      total_cost: row.total_cost,
      components: row.bom_sub_assembly_components ?? [],
    })
  }

  for (const row of indivRes) {
    if (!row?.part_number) continue
    maps.individualByPN.set(norm(row.part_number), {
      id: row.id,
      part_number: row.part_number,
      description: row.description ?? null,
      cost_per_unit: row.cost_per_unit,
      unit: row.unit ?? null,
      supplier: row.supplier ?? null,
    })
  }

  for (const row of drawingsRes) {
    if (!row?.partNumber) continue
    const firstValid = (row.drawingUrls ?? [])
      .map((u) => sanitizeDrawingUrl(u))
      .find((u): u is string => typeof u === 'string')
    maps.drawingsByPN.set(norm(row.partNumber), {
      partNumber: row.partNumber,
      productType: coerceDrawingProductType(row.productType),
      drawingUrl: firstValid ?? null,
    })
  }

  return maps
}
