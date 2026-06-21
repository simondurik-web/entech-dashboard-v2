import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { adjustInventory, reconcileStockEntry } from '@/lib/erpnext/inventory'
import { buildPalletZpl } from '@/lib/erpnext/label'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/adjust — correct a pallet's qty, then reprint.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000

interface AdjustBody {
  batch?: string
  itemCode?: string
  newQty?: number
  station?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AdjustBody
  try {
    body = (await req.json()) as AdjustBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { batch, itemCode, station, idempotencyKey } = body
  const newQty = Number(body.newQty)
  if (
    !batch ||
    !itemCode ||
    !Number.isFinite(newQty) ||
    newQty < 0 ||
    newQty > MAX_QTY ||
    !station ||
    !idempotencyKey
  ) {
    return NextResponse.json(
      { error: 'batch, itemCode, newQty (0..10M), station, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  const { data: stationRow } = await supabaseAdmin
    .from('print_stations')
    .select('id')
    .eq('id', station)
    .eq('enabled', true)
    .single()
  if (!stationRow) {
    return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
  }

  const userId = guard.userId // verified from the session, not a client header
  const printedBy = await resolveUserName(userId)

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'adjust',
    createdBy: userId,
    meta: { item_code: itemCode, qty: newQty, station_id: station, batch },
    erp: () => adjustInventory({ batch, itemCode, newQty, opKey: idempotencyKey }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
    label: async () => {
      const item = await erpnextGetDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode)
      const zpl = buildPalletZpl({
        itemCode,
        itemName: item.item_name ?? itemCode,
        qty: newQty,
        uom: item.stock_uom ?? 'pcs',
        batch,
        generatedAt: new Date().toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
        printedBy,
      })
      const { data: job, error } = await supabaseAdmin
        .from('print_jobs')
        .upsert(
          {
            station_id: station,
            zpl,
            item_code: itemCode,
            batch,
            created_by: userId,
            idempotency_key: `print-${idempotencyKey}`,
            status: 'pending',
          },
          // Insert-or-IGNORE: never reset an already-claimed/printed job to pending.
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (job?.id) return job.id
      const { data: existing } = await supabaseAdmin
        .from('print_jobs')
        .select('id')
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .maybeSingle()
      return existing?.id ?? null
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
