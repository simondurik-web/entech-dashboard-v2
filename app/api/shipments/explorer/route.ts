import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/require-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { etRangeToDates } from '@/lib/shipments/et-date'
import { applyShipmentFilters, normalizeShipmentRow, parseShipmentFilters, SHIPMENT_COLUMNS } from '@/lib/shipments/query'
import type { ShipmentFacets } from '@/lib/shipments/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PAGE_SIZES = new Set([25, 50, 100])

function parseNonNegativeInteger(value: string | null, fallback: number): number | null {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) return null
  return Number(value)
}

async function fetchFacets(from: string | null, to: string | null): Promise<ShipmentFacets> {
  const sources = new Set<string>()
  const services = new Set<string>()
  const pageSize = 1000
  const cap = 5000
  let offset = 0

  while (offset < cap) {
    // Newest-first: with the row cap, a brand-new source_system must still
    // surface in the facet list as the table grows.
    let query = supabaseAdmin
      .from('shipment_history')
      .select('source_system,service')
      .order('id', { ascending: false })

    if (from) {
      const bounds = etRangeToDates(from, from)
      query = query.gte('sent_at', bounds.from.toISOString())
    }
    if (to) {
      const bounds = etRangeToDates(to, to)
      query = query.lt('sent_at', bounds.toExclusive.toISOString())
    }

    const upper = Math.min(offset + pageSize - 1, cap - 1)
    const { data, error } = await query.range(offset, upper)
    if (error) throw new Error(`Supabase shipment facets error: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.source_system) sources.add(String(row.source_system))
      if (row.service) services.add(String(row.service))
    }
    if (data.length < upper - offset + 1) break
    offset += pageSize
  }

  return {
    sources: [...sources].sort((left, right) => left.localeCompare(right)),
    services: [...services].sort((left, right) => left.localeCompare(right)),
  }
}

export async function GET(req: NextRequest) {
  if (!(await requirePermission(req, '/shipments'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = req.nextUrl.searchParams
  const page = parseNonNegativeInteger(params.get('page'), 0)
  const requestedPageSize = parseNonNegativeInteger(params.get('pageSize'), 50)
  const filters = parseShipmentFilters(params)

  if (page === null || requestedPageSize === null || !PAGE_SIZES.has(requestedPageSize) || !filters) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 400 })
  }

  const start = page * requestedPageSize
  const query = applyShipmentFilters(
    supabaseAdmin.from('shipment_history').select(SHIPMENT_COLUMNS, { count: 'exact' }),
    filters
  )
    .order('sent_at', { ascending: false })
    .order('id', { ascending: false })
    .range(start, start + requestedPageSize - 1)

  try {
    const [{ data, error, count }, facets] = await Promise.all([
      query,
      fetchFacets(filters.from, filters.to),
    ])
    if (error) throw new Error(error.message)

    return NextResponse.json(
      {
        rows: (data ?? []).map((row) => normalizeShipmentRow(row as Record<string, unknown>)),
        count: count ?? 0,
        facets,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('shipments explorer lookup failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
