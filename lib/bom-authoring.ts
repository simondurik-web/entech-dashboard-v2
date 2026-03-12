import { recalculateCascade, recalculateFinalAssembly, recalculateSubAssembly } from '@/lib/bom-recalculate'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const FINAL_ASSEMBLY_COMPONENT_SOURCES = ['sub_assembly', 'individual_item'] as const

type FinalAssemblyComponentSource = (typeof FINAL_ASSEMBLY_COMPONENT_SOURCES)[number]

type UnknownRecord = Record<string, unknown>

export class BomAuthoringError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'BomAuthoringError'
    this.status = status
  }
}

type SubAssemblyComponentInput = {
  component_part_number?: unknown
  quantity?: unknown
  is_scrap?: unknown
  scrap_rate?: unknown
}

type FinalAssemblyComponentInput = {
  component_part_number?: unknown
  component_source?: unknown
  quantity?: unknown
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BomAuthoringError('Request body must be a JSON object.')
  }

  return value as UnknownRecord
}

function normalizeString(value: unknown, { required = false }: { required?: boolean } = {}) {
  if (value == null) {
    if (required) throw new BomAuthoringError('This field is required.')
    return null
  }

  const normalized = String(value).trim()
  if (!normalized) {
    if (required) throw new BomAuthoringError('This field is required.')
    return null
  }

  return normalized
}

function normalizeNumber(
  value: unknown,
  {
    field,
    min,
    integer = false,
    allowNull = true,
  }: {
    field: string
    min?: number
    integer?: boolean
    allowNull?: boolean
  }
) {
  if (value === '' || value == null) {
    if (allowNull) return null
    throw new BomAuthoringError(`${field} is required.`)
  }

  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    throw new BomAuthoringError(`${field} must be a valid number.`)
  }
  if (integer && !Number.isInteger(normalized)) {
    throw new BomAuthoringError(`${field} must be a whole number.`)
  }
  if (min != null && normalized < min) {
    throw new BomAuthoringError(`${field} must be at least ${min}.`)
  }

  return normalized
}

function setIfDefined(target: UnknownRecord, key: string, value: unknown) {
  if (value !== undefined) target[key] = value
}

async function ensureUniquePartNumber(
  table: 'bom_sub_assemblies' | 'bom_final_assemblies',
  partNumber: string,
  currentId?: string
) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('id')
    .eq('part_number', partNumber)
    .maybeSingle()

  if (error) throw new BomAuthoringError(error.message, 500)
  if (data && data.id !== currentId) {
    throw new BomAuthoringError(`Part number ${partNumber} already exists.`)
  }
}

async function ensurePartNumbersExist(table: 'bom_individual_items' | 'bom_sub_assemblies', partNumbers: string[], errorMessage: string) {
  if (partNumbers.length === 0) return

  const uniquePartNumbers = [...new Set(partNumbers)]
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('part_number')
    .in('part_number', uniquePartNumbers)

  if (error) throw new BomAuthoringError(error.message, 500)

  const existing = new Set((data || []).map(item => item.part_number))
  const missing = uniquePartNumbers.filter(partNumber => !existing.has(partNumber))
  if (missing.length > 0) {
    throw new BomAuthoringError(`${errorMessage}: ${missing.join(', ')}`)
  }
}

async function normalizeSubAssemblyComponents(components: unknown) {
  if (components == null) return undefined
  if (!Array.isArray(components)) throw new BomAuthoringError('Sub-assembly components must be an array.')

  const normalized = components.map((component, index) => {
    const source = (component || {}) as SubAssemblyComponentInput
    const componentPartNumber = normalizeString(source.component_part_number, { required: true })
    const quantity = normalizeNumber(source.quantity, {
      field: `Sub-assembly component ${index + 1} quantity`,
      min: 0.000001,
      allowNull: false,
    })
    const isScrap = Boolean(source.is_scrap)
    const scrapRate = source.scrap_rate === undefined
      ? null
      : normalizeNumber(source.scrap_rate, {
          field: `Sub-assembly component ${index + 1} scrap rate`,
          min: 0,
        })

    return {
      component_part_number: componentPartNumber,
      quantity,
      cost: 0,
      is_scrap: isScrap,
      scrap_rate: scrapRate,
      sort_order: index,
    }
  })

  await ensurePartNumbersExist(
    'bom_individual_items',
    normalized.filter(component => !component.is_scrap).map(component => component.component_part_number),
    'Unknown individual item component part number'
  )

  return normalized
}

async function normalizeFinalAssemblyComponents(components: unknown) {
  if (components == null) return undefined
  if (!Array.isArray(components)) throw new BomAuthoringError('Final-assembly components must be an array.')

  const normalized = components.map((component, index) => {
    const source = (component || {}) as FinalAssemblyComponentInput
    const componentPartNumber = normalizeString(source.component_part_number, { required: true })
    const rawComponentSource = normalizeString(source.component_source, { required: true })

    if (rawComponentSource === 'individual') {
      throw new BomAuthoringError('component_source value "individual" is invalid. Use "individual_item".')
    }
    if (!FINAL_ASSEMBLY_COMPONENT_SOURCES.includes(rawComponentSource as FinalAssemblyComponentSource)) {
      throw new BomAuthoringError(`Invalid component_source "${rawComponentSource}".`)
    }

    const quantity = normalizeNumber(source.quantity, {
      field: `Final-assembly component ${index + 1} quantity`,
      min: 0.000001,
      allowNull: false,
    })

    return {
      component_part_number: componentPartNumber,
      component_source: rawComponentSource as FinalAssemblyComponentSource,
      quantity,
      cost: 0,
      sort_order: index,
    }
  })

  await ensurePartNumbersExist(
    'bom_sub_assemblies',
    normalized
      .filter(component => component.component_source === 'sub_assembly')
      .map(component => component.component_part_number),
    'Unknown sub-assembly component part number'
  )
  await ensurePartNumbersExist(
    'bom_individual_items',
    normalized
      .filter(component => component.component_source === 'individual_item')
      .map(component => component.component_part_number),
    'Unknown individual-item component part number'
  )

  return normalized
}

async function normalizeSubAssemblyPayload(body: UnknownRecord, currentId?: string, requirePartNumber = false) {
  const payload: UnknownRecord = {}

  if ('part_number' in body || requirePartNumber) {
    const partNumber = normalizeString(body.part_number, { required: true })
    await ensureUniquePartNumber('bom_sub_assemblies', partNumber, currentId)
    payload.part_number = partNumber
  }

  setIfDefined(payload, 'category', 'category' in body ? normalizeString(body.category) : undefined)
  setIfDefined(payload, 'mold_name', 'mold_name' in body ? normalizeString(body.mold_name) : undefined)
  setIfDefined(payload, 'part_weight', 'part_weight' in body ? normalizeNumber(body.part_weight, { field: 'Part weight', min: 0 }) : undefined)
  setIfDefined(payload, 'parts_per_hour', 'parts_per_hour' in body ? normalizeNumber(body.parts_per_hour, { field: 'Parts per hour', min: 0 }) : undefined)
  setIfDefined(payload, 'labor_rate_per_hour', 'labor_rate_per_hour' in body ? normalizeNumber(body.labor_rate_per_hour, { field: 'Labor rate per hour', min: 0 }) : undefined)
  setIfDefined(payload, 'num_employees', 'num_employees' in body ? normalizeNumber(body.num_employees, { field: 'Number of employees', min: 0 }) : undefined)
  payload.updated_at = new Date().toISOString()

  const components = await normalizeSubAssemblyComponents(body.components)
  return { assemblyData: payload, components }
}

async function normalizeFinalAssemblyPayload(body: UnknownRecord, currentId?: string, requirePartNumber = false) {
  const payload: UnknownRecord = {}

  if ('part_number' in body || requirePartNumber) {
    const partNumber = normalizeString(body.part_number, { required: true })
    await ensureUniquePartNumber('bom_final_assemblies', partNumber, currentId)
    payload.part_number = partNumber
  }

  setIfDefined(payload, 'product_category', 'product_category' in body ? normalizeString(body.product_category) : undefined)
  setIfDefined(payload, 'sub_product_category', 'sub_product_category' in body ? normalizeString(body.sub_product_category) : undefined)
  setIfDefined(payload, 'description', 'description' in body ? normalizeString(body.description) : undefined)
  setIfDefined(payload, 'notes', 'notes' in body ? normalizeString(body.notes) : undefined)
  setIfDefined(payload, 'parts_per_package', 'parts_per_package' in body ? normalizeNumber(body.parts_per_package, { field: 'Parts per package', min: 0, integer: true }) : undefined)
  setIfDefined(payload, 'parts_per_hour', 'parts_per_hour' in body ? normalizeNumber(body.parts_per_hour, { field: 'Parts per hour', min: 0 }) : undefined)
  setIfDefined(payload, 'labor_rate_per_hour', 'labor_rate_per_hour' in body ? normalizeNumber(body.labor_rate_per_hour, { field: 'Labor rate per hour', min: 0 }) : undefined)
  setIfDefined(payload, 'num_employees', 'num_employees' in body ? normalizeNumber(body.num_employees, { field: 'Number of employees', min: 0 }) : undefined)
  setIfDefined(payload, 'shipping_labor_cost', 'shipping_labor_cost' in body ? normalizeNumber(body.shipping_labor_cost, { field: 'Shipping labor cost', min: 0 }) : undefined)
  setIfDefined(payload, 'overhead_pct', 'overhead_pct' in body ? normalizeNumber(body.overhead_pct, { field: 'Overhead percent', min: 0 }) : undefined)
  setIfDefined(payload, 'admin_pct', 'admin_pct' in body ? normalizeNumber(body.admin_pct, { field: 'Admin percent', min: 0 }) : undefined)
  setIfDefined(payload, 'depreciation_pct', 'depreciation_pct' in body ? normalizeNumber(body.depreciation_pct, { field: 'Depreciation percent', min: 0 }) : undefined)
  setIfDefined(payload, 'repairs_pct', 'repairs_pct' in body ? normalizeNumber(body.repairs_pct, { field: 'Repairs percent', min: 0 }) : undefined)
  setIfDefined(payload, 'profit_target_pct', 'profit_target_pct' in body ? normalizeNumber(body.profit_target_pct, { field: 'Profit target percent', min: 0 }) : undefined)
  payload.updated_at = new Date().toISOString()

  const components = await normalizeFinalAssemblyComponents(body.components)
  return { assemblyData: payload, components }
}

export async function createSubAssembly(body: unknown) {
  const normalizedBody = asRecord(body)
  const { assemblyData, components } = await normalizeSubAssemblyPayload(normalizedBody, undefined, true)
  const { data, error } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .insert(assemblyData)
    .select()
    .single()

  if (error) throw new BomAuthoringError(error.message, 500)

  try {
    if (components && components.length > 0) {
      const insertPayload = components.map(component => ({ ...component, sub_assembly_id: data.id }))
      const { error: componentsError } = await supabaseAdmin.from('bom_sub_assembly_components').insert(insertPayload)
      if (componentsError) throw new BomAuthoringError(componentsError.message, 500)
    }

    return await recalculateSubAssembly(data.id)
  } catch (error) {
    await supabaseAdmin.from('bom_sub_assemblies').delete().eq('id', data.id)
    throw error
  }
}

export async function updateSubAssembly(id: string, body: unknown) {
  const normalizedBody = asRecord(body)
  const { assemblyData, components } = await normalizeSubAssemblyPayload(normalizedBody, id)
  const { data, error } = await supabaseAdmin
    .from('bom_sub_assemblies')
    .update(assemblyData)
    .eq('id', id)
    .select('id')
    .single()

  if (error) throw new BomAuthoringError(error.message, 500)
  if (!data) throw new BomAuthoringError('Sub-assembly not found.', 404)

  if (components !== undefined) {
    const { error: deleteError } = await supabaseAdmin.from('bom_sub_assembly_components').delete().eq('sub_assembly_id', id)
    if (deleteError) throw new BomAuthoringError(deleteError.message, 500)

    if (components.length > 0) {
      const insertPayload = components.map(component => ({ ...component, sub_assembly_id: id }))
      const { error: componentsError } = await supabaseAdmin.from('bom_sub_assembly_components').insert(insertPayload)
      if (componentsError) throw new BomAuthoringError(componentsError.message, 500)
    }
  }

  const updated = await recalculateSubAssembly(id)
  await recalculateCascade('sub_assembly', id)
  return updated
}

export async function createFinalAssembly(body: unknown) {
  const normalizedBody = asRecord(body)
  const { assemblyData, components } = await normalizeFinalAssemblyPayload(normalizedBody, undefined, true)
  const { data, error } = await supabaseAdmin
    .from('bom_final_assemblies')
    .insert(assemblyData)
    .select()
    .single()

  if (error) throw new BomAuthoringError(error.message, 500)

  try {
    if (components && components.length > 0) {
      const insertPayload = components.map(component => ({ ...component, final_assembly_id: data.id }))
      const { error: componentsError } = await supabaseAdmin.from('bom_final_assembly_components').insert(insertPayload)
      if (componentsError) throw new BomAuthoringError(componentsError.message, 500)
    }

    return await recalculateFinalAssembly(data.id)
  } catch (error) {
    await supabaseAdmin.from('bom_final_assemblies').delete().eq('id', data.id)
    throw error
  }
}

export async function updateFinalAssembly(id: string, body: unknown) {
  const normalizedBody = asRecord(body)
  const { assemblyData, components } = await normalizeFinalAssemblyPayload(normalizedBody, id)
  const { data, error } = await supabaseAdmin
    .from('bom_final_assemblies')
    .update(assemblyData)
    .eq('id', id)
    .select('id')
    .single()

  if (error) throw new BomAuthoringError(error.message, 500)
  if (!data) throw new BomAuthoringError('Final assembly not found.', 404)

  if (components !== undefined) {
    const { error: deleteError } = await supabaseAdmin.from('bom_final_assembly_components').delete().eq('final_assembly_id', id)
    if (deleteError) throw new BomAuthoringError(deleteError.message, 500)

    if (components.length > 0) {
      const insertPayload = components.map(component => ({ ...component, final_assembly_id: id }))
      const { error: componentsError } = await supabaseAdmin.from('bom_final_assembly_components').insert(insertPayload)
      if (componentsError) throw new BomAuthoringError(componentsError.message, 500)
    }
  }

  return await recalculateFinalAssembly(id)
}
