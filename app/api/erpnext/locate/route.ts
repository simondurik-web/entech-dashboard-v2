import { NextRequest, NextResponse } from 'next/server'
import { locateItems } from '@/lib/erpnext/client'
import { listPallets, getBatchLocation } from '@/lib/erpnext/inventory'
import { requireInventoryAccess } from '@/lib/erpnext/auth'

// Search-by-location: GET /api/erpnext/locate?q=Trio%20A
// Returns matching items and every bin that holds them, live from ERPNext, plus
// the pallet ids for stocked items (shown inline). An exact pallet-id query returns
// only that pallet's item (matchedPallet). Read-only; auth-gated.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Cap how many stocked items we enrich with pallet ids, to bound ERPNext calls.
const MAX_PALLET_ENRICH = 12

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json({ results: [], matchedPallet: null })
  }
  try {
    const { results, matchedPallet } = await locateItems(q)
    // Attach pallet ids to stocked items so they show next to the part + location.
    const stocked = results.filter((r) => r.total > 0).slice(0, MAX_PALLET_ENRICH)
    await Promise.all(
      stocked.map(async (r) => {
        try {
          r.pallets = await listPallets(r.itemCode)
        } catch {
          /* leave pallets unset on failure */
        }
      })
    )
    // On an exact pallet scan, make sure the matched pallet's own qty+bin is attached
    // even if it fell outside the enrichment cap — so the UI can show the pallet's
    // quantity (not the part-family total).
    if (matchedPallet && results[0] && !(results[0].pallets ?? []).some((p) => p.batch === matchedPallet)) {
      const loc = await getBatchLocation(matchedPallet, results[0].itemCode)
      if (loc && loc.qty > 0) {
        results[0].pallets = [{ batch: matchedPallet, warehouse: loc.warehouse, qty: loc.qty }, ...(results[0].pallets ?? [])]
      }
    }
    // Live stock — never cache at the edge.
    return NextResponse.json({ results, matchedPallet }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('ERPNext locate failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
