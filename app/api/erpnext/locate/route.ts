import { NextRequest, NextResponse } from 'next/server'
import { locateItems } from '@/lib/erpnext/client'
import { listPallets, getBatchLocation, resolveCurrentSerial, lookupRemovedPallet, type RemovedPalletInfo } from '@/lib/erpnext/inventory'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

// What ENDED a zero-stock pallet, for the search card: shipped on a DN, removed
// by a person, or just zeroed. Best-effort from the two logs we already keep.
export interface PalletTerminal {
  kind: 'shipped' | 'removed' | 'zeroed'
  at: string | null
  by: string | null
  dn?: string | null
  so?: string | null
  customer?: string | null
  reason?: string | null
}

async function terminalForFamily(family: string[]): Promise<PalletTerminal> {
  const serials = family.filter((s) => /^[0-9A-Z-]+$/i.test(s))
  type ShipRow = { dn_number: string; so_number: string; customer: string | null; user_name: string | null; created_at: string }
  // pallets is jsonb — .contains() per serial (families are 1–3 codes).
  const shipRows = (
    await Promise.all(
      serials.map(async (s) => {
        const { data } = await supabaseAdmin
          .from('fulfillment_log')
          .select('dn_number, so_number, customer, user_name, created_at')
          .eq('action', 'complete')
          .contains('pallets', JSON.stringify([s]))
          .order('created_at', { ascending: false })
          .limit(1)
        return (data ?? []) as ShipRow[]
      })
    )
  ).flat()
  const ship = shipRows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  const { data: removeRows } = serials.length
    ? await supabaseAdmin
        .from('inventory_ops_log')
        .select('created_by, created_at')
        .eq('action', 'remove')
        .in('status', ['done', 'erp_committed'])
        .in('batch', serials)
        .order('created_at', { ascending: false })
        .limit(1)
    : { data: [] as { created_by: string | null; created_at: string }[] }
  const remove = (removeRows ?? [])[0]
  // Latest event wins (a pallet can be removed, restored, then shipped).
  if (ship && (!remove || ship.created_at > remove.created_at)) {
    return { kind: 'shipped', at: ship.created_at, by: ship.user_name, dn: ship.dn_number, so: ship.so_number, customer: ship.customer }
  }
  if (remove) {
    let by: string | null = null
    if (remove.created_by) {
      const { data: p } = await supabaseAdmin.from('user_profiles').select('full_name, email').eq('id', remove.created_by).maybeSingle()
      by = p?.full_name || p?.email || null
    }
    return { kind: 'removed', at: remove.created_at, by }
  }
  return { kind: 'zeroed', at: null, by: null }
}

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
    const located = await locateItems(q)
    const results = located.results
    let matchedPallet = located.matchedPallet
    const scannedPallet = located.matchedPallet // original scanned code, before resolve
    // If a pallet id was scanned, resolve it to the CURRENT serial in its family. A
    // superseded (reprinted/qty-changed) label points the UI at the live pallet and
    // flags that the scanned label is stale.
    let superseded: { scanned: string; current: string | null } | null = null
    let removedPallet: (RemovedPalletInfo & { terminal?: PalletTerminal }) | null = null
    if (matchedPallet) {
      const res = await resolveCurrentSerial(matchedPallet)
      if (res.superseded) superseded = { scanned: matchedPallet, current: res.current }
      if (res.current) {
        matchedPallet = res.current
      } else {
        // No active serial holds stock -> the pallet was removed/zeroed/shipped.
        // Surface its data (part, last label qty, last bin) plus WHAT ended it, so
        // a dead label still tells its story (Simon 2026-07-03). Best-effort.
        removedPallet = await lookupRemovedPallet(scannedPallet as string).catch(() => null)
        if (removedPallet) {
          removedPallet.terminal = await terminalForFamily(removedPallet.family).catch(() => undefined)
        }
      }
    }
    // Attach pallet ids to stocked items so they show next to the part + location. Skip
    // non-serialized items — they have no pallets (the UI renders quantity mode instead).
    const stocked = results.filter((r) => r.total > 0 && r.hasBatch).slice(0, MAX_PALLET_ENRICH)
    await Promise.all(
      stocked.map(async (r) => {
        try {
          r.pallets = await listPallets(r.itemCode)
        } catch {
          /* leave pallets unset on failure */
        }
      })
    )
    // Make sure the matched pallet's own qty+bin is attached even if outside the cap.
    if (matchedPallet && results[0] && !(results[0].pallets ?? []).some((p) => p.batch === matchedPallet)) {
      const loc = await getBatchLocation(matchedPallet, results[0].itemCode)
      if (loc && loc.qty > 0) {
        results[0].pallets = [{ batch: matchedPallet, warehouse: loc.warehouse, qty: loc.qty }, ...(results[0].pallets ?? [])]
      }
    }
    // Live stock — never cache at the edge.
    return NextResponse.json({ results, matchedPallet, superseded, removedPallet }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('ERPNext locate failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
