import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { itemNameMap, batchWeightDims } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/recent-labels?limit=10
// The most recently printed labels, so an operator can find a label whose print jammed
// (and reprint it from its id) instead of guessing. Each row: label (batch/pallet id),
// part, printer (name + location), purpose (the action that produced it), who printed it,
// when, and the print status. Read-only; auth-gated. Pure Supabase (no ERPNext call).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  // Default to 10 when `limit` is absent/invalid (Number(null) would be 0 -> wrong); clamp 1..50.
  const param = req.nextUrl.searchParams.get('limit')
  const n = param == null ? NaN : Number(param)
  const limit = Number.isFinite(n) && n >= 1 ? Math.min(Math.trunc(n), MAX_LIMIT) : DEFAULT_LIMIT

  try {
    const { data: jobs, error } = await supabaseAdmin
      .from('print_jobs')
      .select('id, batch, item_code, station_id, created_by, created_at, status, claimed_at, printed_at, error, idempotency_key')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    const rows = jobs ?? []
    if (rows.length === 0) return NextResponse.json({ labels: [] }, { headers: { 'Cache-Control': 'no-store' } })

    // Resolve printer name/location, who printed, and the purpose (the op action), each in
    // one batched query keyed by the ids/keys collected from the print jobs.
    const stationIds = [...new Set(rows.map((r) => r.station_id).filter(Boolean))] as string[]
    const userIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[]
    // The print job's idempotency_key is `print-<opKey>`; the op log row keyed by <opKey>
    // carries the action (add / adjust / reprint / ...).
    const opKeyOf = (k: string | null) => (k && k.startsWith('print-') ? k.slice('print-'.length) : null)
    const opKeys = [...new Set(rows.map((r) => opKeyOf(r.idempotency_key)).filter(Boolean))] as string[]
    const itemCodes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))] as string[]

    const batchIds = [...new Set(rows.map((r) => r.batch).filter(Boolean))] as string[]
    const [stationsRes, profilesRes, opsRes, itemMeta, weightDims] = await Promise.all([
      stationIds.length
        ? supabaseAdmin.from('print_stations').select('id, name, location').in('id', stationIds)
        : Promise.resolve({ data: [] as { id: string; name: string | null; location: string | null }[] }),
      userIds.length
        ? supabaseAdmin.from('user_profiles').select('id, full_name, email').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
      opKeys.length
        ? supabaseAdmin.from('inventory_ops_log').select('idempotency_key, action, qty, warehouse').in('idempotency_key', opKeys)
        : Promise.resolve({ data: [] as { idempotency_key: string; action: string; qty: number | null; warehouse: string | null }[] }),
      // Pieces-per-pack so the panel can show the part total for non-serialized labels.
      // Best-effort (ERPNext) — degrade to an empty map rather than failing the panel.
      itemCodes.length
        ? itemNameMap(itemCodes).catch(() => new Map<string, { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }>())
        : Promise.resolve(new Map<string, { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }>()),
      // Pallet weight/dims for the history rows — best-effort like the rest.
      batchIds.length
        ? batchWeightDims(batchIds).catch(() => new Map<string, { weightLb: number | null; dims: string | null }>())
        : Promise.resolve(new Map<string, { weightLb: number | null; dims: string | null }>()),
    ])

    // These enrichments are non-critical (the label id is the point); if one errors, log it
    // and degrade to a missing field rather than failing the whole panel.
    for (const [label, res] of [
      ['print_stations', stationsRes],
      ['user_profiles', profilesRes],
      ['inventory_ops_log', opsRes],
    ] as const) {
      if ('error' in res && res.error) console.error(`recent-labels: ${label} enrichment failed:`, res.error.message)
    }
    const stationMap = new Map((stationsRes.data ?? []).map((s) => [s.id, s]))
    const nameMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name || p.email || '']))
    const opMap = new Map((opsRes.data ?? []).map((o) => [o.idempotency_key, o]))

    const labels = rows.map((r) => {
      const st = r.station_id ? stationMap.get(r.station_id) : undefined
      const opKey = opKeyOf(r.idempotency_key)
      const op = opKey ? opMap.get(opKey) : undefined
      return {
        batch: r.batch,
        itemCode: r.item_code,
        printer: st ? st.name || st.location || r.station_id : r.station_id,
        printerLocation: st?.location ?? null,
        purpose: op?.action ?? null,
        // Bin/area the label was allocated to + the parts count printed on it
        // (from the op log row that produced this print).
        warehouse: op?.warehouse ?? null,
        qty: op?.qty ?? null,
        // For non-serialized items, qty is BOXES; multiply by this for the part total.
        piecesPerPack: itemMeta.get(r.item_code)?.piecesPerPack ?? 1,
        weightLb: r.batch ? (weightDims.get(r.batch)?.weightLb ?? null) : null,
        dims: r.batch ? (weightDims.get(r.batch)?.dims ?? null) : null,
        by: r.created_by ? nameMap.get(r.created_by) ?? '' : '',
        at: r.created_at,
        status: r.status,
        claimedAt: r.claimed_at,
        printedAt: r.printed_at,
        error: r.error ?? null,
      }
    })

    return NextResponse.json({ labels }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('recent-labels lookup failed:', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
