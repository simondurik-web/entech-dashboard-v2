import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { itemNameMap, deletedPalletMeta } from '@/lib/erpnext/inventory'

// GET /api/erpnext/inventory/recent-deletions?limit=10
// The most recently DELETED pallets (serialized removals), so a pallet deleted by mistake
// can be returned to inventory in one click — same label if the same quantity, a new label
// if the quantity changed. Mirrors recent-labels: each row carries the pallet id, the label
// quantity, the bin, who deleted it, and when. A deletion already undone (a later restore on
// the same pallet family) is flagged `restored` so the client disables its restore button
// (re-restoring would double the stock). Read-only; auth-gated (the restore action itself is
// office-only, enforced by the restore route).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const param = req.nextUrl.searchParams.get('limit')
  const n = param == null ? NaN : Number(param)
  const limit = Number.isFinite(n) && n >= 1 ? Math.min(Math.trunc(n), MAX_LIMIT) : DEFAULT_LIMIT

  try {
    // Successful serialized pallet removals, newest first.
    const { data: removes, error } = await supabaseAdmin
      .from('inventory_ops_log')
      .select('idempotency_key, batch, item_code, family, created_by, created_at')
      .eq('action', 'remove')
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    const rows = (removes ?? []).filter((r) => r.batch)
    if (rows.length === 0) return NextResponse.json({ deletions: [] }, { headers: { 'Cache-Control': 'no-store' } })

    const batches = [...new Set(rows.map((r) => r.batch).filter(Boolean))] as string[]
    const itemCodes = [...new Set(rows.map((r) => r.item_code).filter(Boolean))] as string[]
    const userIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[]
    const families = [...new Set(rows.map((r) => r.family).filter(Boolean))] as string[]

    const [profilesRes, restoresRes, itemMeta, palletMeta] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from('user_profiles').select('id, full_name, email').in('id', userIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string | null }[] }),
      // Successful restores on these families — used to flag a deletion that's already undone.
      families.length
        ? supabaseAdmin.from('inventory_ops_log').select('family, created_at').eq('action', 'restore').eq('status', 'done').in('family', families)
        : Promise.resolve({ data: [] as { family: string; created_at: string }[] }),
      // Item names + uom (best-effort — the panel still works without them).
      itemCodes.length
        ? itemNameMap(itemCodes).catch(() => new Map<string, { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }>())
        : Promise.resolve(new Map<string, { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number }>()),
      // Label qty + last bin (from ERPNext — both survive removal). Best-effort.
      deletedPalletMeta(batches).catch(() => new Map<string, { labelQty: number | null; lastWarehouse: string | null }>()),
    ])

    if ('error' in profilesRes && profilesRes.error) console.error('recent-deletions: user_profiles enrichment failed:', profilesRes.error.message)
    if ('error' in restoresRes && restoresRes.error) console.error('recent-deletions: restore lookup failed:', restoresRes.error.message)

    const nameMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p.full_name || p.email || '']))
    // family -> latest successful restore timestamp.
    const restoredAt = new Map<string, string>()
    for (const r of restoresRes.data ?? []) {
      const cur = restoredAt.get(r.family)
      if (!cur || r.created_at > cur) restoredAt.set(r.family, r.created_at)
    }

    const deletions = rows.map((r) => {
      const meta = r.batch ? palletMeta.get(r.batch) : undefined
      const item = r.item_code ? itemMeta.get(r.item_code) : undefined
      // Undone if a restore on this family happened after this deletion.
      const restoredTs = r.family ? restoredAt.get(r.family) : undefined
      const restored = !!(restoredTs && r.created_at && restoredTs > r.created_at)
      return {
        batch: r.batch,
        itemCode: r.item_code,
        itemName: item?.itemName ?? null,
        uom: item?.uom ?? 'pcs',
        qty: meta?.labelQty ?? null,
        warehouse: meta?.lastWarehouse ?? null,
        by: r.created_by ? nameMap.get(r.created_by) ?? '' : '',
        at: r.created_at,
        restored,
      }
    })

    return NextResponse.json({ deletions }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('recent-deletions lookup failed:', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
