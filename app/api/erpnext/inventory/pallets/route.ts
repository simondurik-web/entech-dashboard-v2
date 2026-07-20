import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { listPallets } from '@/lib/erpnext/inventory'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET /api/erpnext/inventory/pallets?itemCode=  -> on-hand pallets for an item,
// each stamped with where its label was LAST sent (Simon 2026-07-20: after a
// reprint the crew needs to see which printer got it). Best-effort: a lookup
// failure just omits the field.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  const itemCode = req.nextUrl.searchParams.get('itemCode')?.trim() ?? ''
  if (!itemCode) return NextResponse.json({ pallets: [] })
  try {
    const pallets = await listPallets(itemCode)
    let printedAt: Record<string, string> = {}
    try {
      const batches = pallets.map((p) => p.batch).filter(Boolean)
      if (batches.length) {
        const { data: jobs } = await supabaseAdmin
          .from('print_jobs')
          .select('batch, station_id, created_at')
          .in('batch', batches)
          .order('created_at', { ascending: false })
          .limit(500)
        const latest = new Map<string, string>()
        for (const j of jobs ?? []) {
          if (j.batch && j.station_id && !latest.has(j.batch)) latest.set(j.batch, j.station_id)
        }
        const ids = [...new Set(latest.values())]
        if (ids.length) {
          const { data: sts } = await supabaseAdmin.from('print_stations').select('id, name').in('id', ids)
          const nameOf = new Map((sts ?? []).map((s) => [s.id, s.name as string]))
          printedAt = Object.fromEntries(
            [...latest.entries()].map(([b, sid]) => [b, nameOf.get(sid) ?? sid])
          )
        }
      }
    } catch (e) {
      console.error('last-print lookup failed:', e)
    }
    const withPrint = pallets.map((p) => ({ ...p, printedAt: printedAt[p.batch] ?? null }))
    return NextResponse.json({ pallets: withPrint }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('list pallets failed:', error)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 })
  }
}
