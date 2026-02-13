import { NextResponse } from 'next/server'
import { fetchSheetData, fetchOrders, fetchInventory, GIDS, type Order } from '@/lib/google-sheets'

export interface MaterialSource {
  component: string
  qty: number
  materialPerUnit: number
  totalLbs: number
  sourceLabel: string
}

export interface MaterialRequirement {
  name: string
  onHand: number
  needed: number
  surplus: number
  coverage: number
  status: 'ok' | 'low' | 'shortage'
  sources: MaterialSource[]
  category: string
}

export interface HubBreakdown {
  part: string
  qty: number
  weight: number
  category: string
  materials: { name: string; perUnit: number; total: number }[]
}

export interface TireBreakdown {
  part: string
  qty: number
  weight: number
  materials: { name: string; perUnit: number; total: number }[]
}

export interface MaterialRequirementsData {
  totalOpenOrders: number
  totalHubs: number
  totalTires: number
  materials: MaterialRequirement[]
  hubs: HubBreakdown[]
  tires: TireBreakdown[]
  shortageCount: number
  totalUrethane: number
  totalCrumbRubber: number
}

function parseSheetFloat(val: string): number {
  if (!val) return 0
  let clean = val.replace(/,/g, '').replace(/%/g, '')
  const isPercent = val.includes('%')
  const num = parseFloat(clean) || 0
  return isPercent ? num / 100 : num
}

export async function GET() {
  try {
    // Fetch BOM Sub-Assembly data (has component material breakdowns), orders, and inventory in parallel
    const [bomSubSheet, orders, inventory] = await Promise.all([
      fetchSheetData(GIDS.bomSub),
      fetchOrders(),
      fetchInventory(),
    ])

    // Build BOM sub-assembly map: partName -> { weight, materials[], category }
    const { cols: bomCols, rows: bomRows } = bomSubSheet
    const bom2Map = new Map<string, {
      weight: number
      materials: { name: string; qtyPerUnit: number }[]
      category: string
    }>()

    for (const row of bomRows) {
      // Find part name - check various column patterns
      let partName = ''
      let weight = 0
      let category = ''
      const materials: { name: string; qtyPerUnit: number }[] = []

      for (let i = 0; i < bomCols.length; i++) {
        const label = (bomCols[i] || '').toLowerCase().trim()
        const cell = row.c[i]
        const val = cell?.v != null ? String(cell.v) : ''

        if (label.includes('part name') || (i === 0 && !partName)) {
          if (val.trim()) partName = val.trim()
        }
        if (label.includes('part weight') || label.includes('weight')) {
          weight = parseSheetFloat(val)
        }
        if (label.includes('sub-product category') || label.includes('category')) {
          category = val.trim()
        }
      }

      // Extract components 1-5
      for (let c = 1; c <= 5; c++) {
        let compName = ''
        let compQty = 0
        for (let i = 0; i < bomCols.length; i++) {
          const label = (bomCols[i] || '').trim()
          const cell = row.c[i]
          const val = cell?.v != null ? String(cell.v) : ''

          if (label === `Component ${c}` || label === `Component ${c} `) {
            compName = val.trim()
          }
          if (label === `Component ${c} Qty.` || label === `Component ${c} Qty`) {
            compQty = parseSheetFloat(val)
          }
        }
        if (compName && compQty > 0 && compName.toLowerCase() !== 'scrap') {
          materials.push({ name: compName, qtyPerUnit: compQty })
        }
      }

      if (partName) {
        bom2Map.set(partName, { weight, materials, category })
      }
    }

    // Filter to open orders only (fetchOrders already filters cancelled)
    const shippedStatuses = new Set(['staged', 'shipped', 'invoiced'])
    const openOrders = orders.filter((o: Order) => {
      const status = (o.internalStatus || o.ifStatus || '').toLowerCase()
      return !shippedStatuses.has(status)
    })

    // Aggregate hub and tire demand from orders
    const hubDemand = new Map<string, number>()
    const tireDemand = new Map<string, number>()
    let totalOpenOrders = 0

    for (const order of openOrders) {
      const qty = order.orderQty
      if (qty <= 0) continue
      totalOpenOrders++

      const hub = (order.hub || '').trim()
      const tire = (order.tire || '').trim()

      if (hub) hubDemand.set(hub, (hubDemand.get(hub) || 0) + qty)
      if (tire) tireDemand.set(tire, (tireDemand.get(tire) || 0) + qty)
    }

    // Calculate raw material demand
    const materialDemand = new Map<string, { needed: number; sources: MaterialSource[] }>()

    function addMaterialDemand(componentName: string, componentQty: number, sourceLabel: string) {
      const bom = bom2Map.get(componentName)
      if (!bom) return
      for (const mat of bom.materials) {
        const totalLbs = mat.qtyPerUnit * componentQty
        if (!materialDemand.has(mat.name)) {
          materialDemand.set(mat.name, { needed: 0, sources: [] })
        }
        const entry = materialDemand.get(mat.name)!
        entry.needed += totalLbs
        entry.sources.push({
          component: componentName,
          qty: componentQty,
          materialPerUnit: mat.qtyPerUnit,
          totalLbs,
          sourceLabel,
        })
      }
    }

    for (const [hub, qty] of hubDemand) addMaterialDemand(hub, qty, 'Hub')
    for (const [tire, qty] of tireDemand) addMaterialDemand(tire, qty, 'Tire')

    // Build inventory lookup
    const inventoryLookup = new Map<string, number>()
    for (const item of inventory) {
      if (item.partNumber) {
        inventoryLookup.set(item.partNumber.trim(), item.inStock)
      }
    }

    // Build materials array with status
    const materials: MaterialRequirement[] = Array.from(materialDemand.entries()).map(([name, data]) => {
      const onHand = inventoryLookup.get(name) || 0
      const needed = Math.round(data.needed)
      const surplus = onHand - needed
      const coverage = needed > 0 ? Math.min(100, Math.round((onHand / needed) * 100)) : 100
      let status: 'ok' | 'low' | 'shortage' = 'ok'
      if (surplus < 0 && coverage < 50) status = 'shortage'
      else if (surplus < 0) status = 'low'

      // Determine category from the components that use this material
      const categories = new Set<string>()
      for (const src of data.sources) {
        const bom = bom2Map.get(src.component)
        if (bom?.category) categories.add(bom.category)
      }
      const category = categories.size === 1 ? Array.from(categories)[0] : categories.size > 1 ? 'Multiple' : 'Other'

      return { name, onHand, needed, surplus, coverage, status, sources: data.sources, category }
    }).sort((a, b) => a.surplus - b.surplus)

    // Hub breakdown
    const hubs: HubBreakdown[] = Array.from(hubDemand.entries()).map(([hub, qty]) => {
      const bom = bom2Map.get(hub)
      return {
        part: hub,
        qty,
        weight: bom?.weight || 0,
        category: bom?.category || '',
        materials: bom?.materials.map(m => ({
          name: m.name,
          perUnit: m.qtyPerUnit,
          total: Math.round(m.qtyPerUnit * qty),
        })) || [],
      }
    }).sort((a, b) => b.qty - a.qty)

    // Tire breakdown
    const tires: TireBreakdown[] = Array.from(tireDemand.entries()).map(([tire, qty]) => {
      const bom = bom2Map.get(tire)
      return {
        part: tire,
        qty,
        weight: bom?.weight || 0,
        materials: bom?.materials.map(m => ({
          name: m.name,
          perUnit: m.qtyPerUnit,
          total: Math.round(m.qtyPerUnit * qty),
        })) || [],
      }
    }).sort((a, b) => b.qty - a.qty)

    const result: MaterialRequirementsData = {
      totalOpenOrders,
      totalHubs: Array.from(hubDemand.values()).reduce((s, v) => s + v, 0),
      totalTires: Array.from(tireDemand.values()).reduce((s, v) => s + v, 0),
      materials,
      hubs,
      tires,
      shortageCount: materials.filter(m => m.status === 'shortage' || m.status === 'low').length,
      totalUrethane: materials.filter(m => m.name.toLowerCase().includes('urth')).reduce((s, m) => s + m.needed, 0),
      totalCrumbRubber: materials.filter(m => m.name.toLowerCase().includes('abr')).reduce((s, m) => s + m.needed, 0),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Failed to compute material requirements:', error)
    return NextResponse.json(
      { error: 'Failed to compute material requirements' },
      { status: 500 }
    )
  }
}
