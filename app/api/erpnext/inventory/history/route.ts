import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { palletBase } from '@/lib/erpnext/inventory'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/erpnext/inventory/history?batch=<palletId>
// Full traceability timeline for one pallet, read from the operations log
// (which already stamps who + when on every action). Read-only.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface HistoryEvent {
  action: string
  at: string | null
  by: string // resolved user name/email, or '' if unknown
  qty: number | null
  warehouse: string | null
  station: string | null
}

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const batch = req.nextUrl.searchParams.get('batch')?.trim() ?? ''
  if (!batch) return NextResponse.json({ events: [] })

  // Chain the whole serial family (base + base-NN) so a reissued pallet shows its
  // complete lineage (created -> qty changed -> reprinted -> ...), not just one serial.
  // Whitelist, don't blocklist: pallet codes are Crockford base32 (so [0-9A-Z]); strip
  // everything else so no PostgREST filter syntax (*, %, _, ',', parens, dots) can leak
  // into the .or() string below and broaden/break the match.
  const fam = palletBase(batch).toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (!fam) return NextResponse.json({ events: [] })

  // Committed events only (skip failed/in-flight rows). Oldest first so the UI can
  // derive transitions.
  const { data: rows, error } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('action, status, created_by, qty, warehouse, station_id, created_at, batch')
    .or(`batch.eq.${fam},batch.like.${fam}-*`)
    .in('status', ['done', 'erp_committed'])
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'history lookup failed' }, { status: 502 })
  }

  // Resolve user ids -> display names in one query.
  const ids = [...new Set((rows ?? []).map((r) => r.created_by).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('id, full_name, email')
      .in('id', ids)
    for (const p of profiles ?? []) names.set(p.id, p.full_name || p.email || '')
  }

  const events: HistoryEvent[] = (rows ?? []).map((r) => ({
    action: r.action,
    at: r.created_at,
    by: r.created_by ? names.get(r.created_by) ?? '' : '',
    qty: r.qty ?? null,
    warehouse: r.warehouse ?? null,
    station: r.station_id ?? null,
  }))

  // Merge in shipping events from the fulfillment log so a pallet's timeline
  // tells the WHOLE story — including the system zeroing it by shipping it
  // (Simon 2026-07-03). pallets is jsonb; contains() per family serial.
  const serials = [...new Set([fam, ...(rows ?? []).map((r) => r.batch).filter(Boolean)])] as string[]
  const shipRows = (
    await Promise.all(
      serials.map(async (s) => {
        const { data } = await supabaseAdmin
          .from('fulfillment_log')
          .select('action, dn_number, so_number, user_name, created_at')
          .in('action', ['complete', 'undo'])
          .contains('pallets', JSON.stringify([s]))
        return data ?? []
      })
    )
  ).flat()
  const seenShip = new Set<string>()
  for (const s of shipRows) {
    const key = `${s.action}-${s.dn_number}-${s.created_at}`
    if (seenShip.has(key)) continue
    seenShip.add(key)
    events.push({
      action: s.action === 'complete' ? 'shipped' : 'unshipped',
      at: s.created_at,
      by: s.user_name ?? '',
      qty: null,
      // Reuses the warehouse display slot to carry "DN · SO" context.
      warehouse: [s.dn_number, s.so_number].filter(Boolean).join(' · ') || null,
      station: null,
    })
  }
  events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))

  return NextResponse.json({ events }, { headers: { 'Cache-Control': 'no-store' } })
}
