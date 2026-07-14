import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { reserveBatchesToSO, reservationsForBatches, releaseBatchReservation } from '@/lib/erpnext/staging'
import { reserveNextSerial, reissuePallet, palletBase } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp, brandForItemGroup } from '@/lib/erpnext/label'
import { resolveCustomerPartNo, resolveSalesOrderPoNo } from '@/lib/erpnext/customer-part'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment, flipDashboardStatus } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/staging/assign
// Reserve a set of scanned pallets (batches) to an open Sales Order in ERPNext.
// Body: { soName, pallets: [{ batch, itemCode, warehouse, qty }], idempotencyKey }.
// Idempotent via runInventoryOp: the op identity binds to the SO + the exact pallet set, so a
// double-tap or timeout-then-retry reuses the row instead of double-reserving. A reservation
// can't over-reserve a batch anyway (ERPNext caps at the stock's available-to-reserve qty), so
// a retry that re-runs is safe. family is null — this spans many pallets, outside the per-pallet
// lock, and it posts no Stock Entry.

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Reserving each pallet is a sequential SBB-create + reservation call; give a big queue room.
export const maxDuration = 120

const MAX_PALLETS = 200

interface AssignBody {
  soName?: string
  pallets?: { batch?: string; itemCode?: string; warehouse?: string; qty?: number }[]
  // Move pallets already reserved to ANOTHER order onto this one (release +
  // re-reserve). Without it, such pallets 409 with the conflict list so the UI
  // can ask the operator to confirm the move (Simon 2026-07-03).
  allowMove?: boolean
  // Printer station for the fresh labels moves require: a moved pallet is
  // REISSUED (new code, old label rejected natively) so the physical label
  // can never show the old order's info (Simon 2026-07-03).
  station?: string
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AssignBody
  try {
    body = (await req.json()) as AssignBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const soName = body.soName?.trim()
  const idempotencyKey = body.idempotencyKey
  const rawPallets = Array.isArray(body.pallets) ? body.pallets : []
  if (!soName || !idempotencyKey || rawPallets.length === 0) {
    return NextResponse.json({ error: 'soName, pallets, and idempotencyKey are required' }, { status: 400 })
  }
  if (rawPallets.length > MAX_PALLETS) {
    return NextResponse.json({ error: `Too many pallets in one staging (max ${MAX_PALLETS})` }, { status: 400 })
  }

  const seen = new Set<string>()
  const pallets = rawPallets
    .map((p) => ({
      batch: (p.batch ?? '').trim(),
      itemCode: (p.itemCode ?? '').trim(),
      warehouse: (p.warehouse ?? '').trim(),
      qty: Number(p.qty),
    }))
    .filter((p) => p.batch && p.itemCode && p.warehouse && Number.isFinite(p.qty) && p.qty > 0)
    // De-dupe by batch: a batch can only be reserved once per request.
    .filter((p) => !seen.has(p.batch) && (seen.add(p.batch), true))
  if (pallets.length === 0) {
    return NextResponse.json({ error: 'No valid pallet lines' }, { status: 400 })
  }

  const userId = guard.userId

  // Do not stage a pallet that is in the middle of an inventory operation.
  //
  // A move/adjust/reprint/remove has to UN-STAGE a pallet before it can touch it (ERPNext
  // refuses to move reserved stock) and re-stages it afterwards. During that window the
  // pallet looks unreserved — and staging it to a different order here would quietly steal
  // stock the original order is still counting on. The op detects the theft and warns, but
  // by then the reservation has moved. Refusing while an operation holds the pallet's family
  // closes the window instead of reporting it after the fact. (codex BLOCKER, 2026-07-14.)
  //
  // Reads the same partial unique index the ops use as their lock — staging now participates
  // in it rather than working around it.
  const { data: busy, error: busyErr } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('batch, action')
    .in('family', [...new Set(pallets.map((p) => palletBase(p.batch)))])
    // failed_pre_erp counts too: such a row still HOLDS the family lock, and it may carry
    // reservation debt — a Sales Order the pallet still owes itself back to. Staging it to a
    // different order before that is settled is exactly the cross-order theft we're closing.
    .in('status', ['pending', 'erp_committed', 'failed_pre_erp'])
    .limit(1)
  // Fail CLOSED: if we cannot tell whether a pallet is mid-operation, do not stage it.
  if (busyErr) {
    return NextResponse.json({ error: 'Could not verify the pallets are free to stage; try again.' }, { status: 503 })
  }
  if (busy && busy.length) {
    return NextResponse.json(
      {
        error: `Pallet ${busy[0].batch ?? ''} has an unfinished ${busy[0].action ?? 'operation'} on it. Finish or clear that first, then stage it.`.replace('  ', ' '),
      },
      { status: 409 }
    )
  }

  // Pallets reserved to a DIFFERENT order: hard-stop unless the operator
  // explicitly confirmed the move (allowMove). Same-order reservations are
  // filtered out (already staged — nothing to do for them).
  // Retry of a partially-committed request: reuse the PLAN stored with the op
  // row (moves + pinned new serials) instead of recomputing — after a partial
  // run the old reservations are gone and recomputation would both miss the
  // moves and mint fresh serials (phantom reissues). New request -> plan now.
  type MovePlan = { oldBatch: string; newBatch: string; fromSo: string; customer: string | null; itemCode: string; qty: number }
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('item_code')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  let moves: MovePlan[]
  if (priorOp?.item_code) {
    try {
      moves = (JSON.parse(priorOp.item_code).relabels ?? []) as MovePlan[]
    } catch {
      moves = []
    }
  } else {
    const existing = await reservationsForBatches(pallets.map((p) => p.batch))
    const conflicts = pallets
      .map((p) => ({ p, r: existing[p.batch] }))
      .filter((x): x is { p: (typeof pallets)[number]; r: NonNullable<(typeof existing)[string]> } => !!x.r && x.r.so !== soName)
    if (conflicts.length > 0 && !body.allowMove) {
      return NextResponse.json(
        {
          error: 'Some pallets are reserved to another order',
          moves: conflicts.map(({ r }) => ({ batch: r.batch, so: r.so, customer: r.customer })),
        },
        { status: 409 }
      )
    }
    // Pin each move's new serial NOW so a retry can never mint a second one.
    moves = []
    for (const { p, r } of conflicts) {
      moves.push({
        oldBatch: p.batch,
        newBatch: await reserveNextSerial(p.batch),
        fromSo: r.so,
        customer: r.customer,
        itemCode: p.itemCode,
        qty: p.qty,
      })
    }
  }

  // Moves reissue the pallet + print a fresh label, so they need a printer.
  const station = body.station?.trim()
  if (moves.length > 0) {
    if (!station) {
      return NextResponse.json({ error: 'A printer station is required to move pallets (new labels print)' }, { status: 400 })
    }
    const { data: stationRow } = await supabaseAdmin
      .from('print_stations')
      .select('id')
      .eq('id', station)
      .eq('enabled', true)
      .single()
    if (!stationRow) return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
    if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
      return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
    }
  }

  // Bind the op identity to SO + the exact (sorted, de-duped) pallet set — and the move
  // plan, so a retry replays the SAME releases/reissues instead of recomputing them.
  const fingerprint = JSON.stringify({
    so: soName,
    batches: [...new Set(pallets.map((p) => p.batch))].sort(),
    relabels: moves,
  })

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'stage-reserve',
    createdBy: userId,
    // family null: spans many pallets, no Stock Entry, so it sits outside the per-pallet lock.
    meta: { warehouse: soName, qty: pallets.length, item_code: fingerprint, batch: null, family: null },
    erp: async () => {
      // Moved pallets: release the old reservation, REISSUE the pallet to its
      // PINNED new code (ERPNext rejects the old label natively, so the stale
      // physical label can never ship the wrong order — Simon 2026-07-03).
      // Every step is idempotent against the pinned plan: release no-ops when
      // already released, reissuePallet is resumable toward the same target.
      const printedBy = await resolveUserName(userId)
      for (const m of moves) {
        const entry = pallets.find((p) => p.batch === m.oldBatch)
        const rel = await releaseBatchReservation(m.oldBatch, m.fromSo)
        await reissuePallet({
          oldBatch: m.oldBatch,
          newBatch: m.newBatch,
          itemCode: m.itemCode,
          targetQty: m.qty,
          opKey: `${idempotencyKey}-mv-${m.oldBatch}`,
        })
        if (entry) entry.batch = m.newBatch // the reservation below targets the new code
        if (rel.released) {
          logFulfillment({
            action: 'move_reservation',
            so: soName,
            dn: '-',
            customer: m.customer,
            pallets: [m.oldBatch],
            userId,
            userName: printedBy,
            detail: `moved ${m.oldBatch} from ${m.fromSo}; relabeled as ${m.newBatch}`,
          })
        }
      }

      const committed = await reserveBatchesToSO({ soName, items: pallets })

      // Instant status flip for the lines these pallets fully covered — the
      // 5-min sync reaches the same answer, this just kills the lag window
      // (SO-00077 release 2 read Pending for minutes after staging, 2026-07-06).
      if (committed.fullyReservedSoItems.length > 0) {
        flipDashboardStatus(soName, 'staged', committed.fullyReservedSoItems)
      }

      // Fresh labels for the moved pallets, printed with the NEW order on them.
      for (const r of moves) {
        try {
          const [item, batchDoc, custPartNo, custPo] = await Promise.all([
            erpnextGetDoc<{ item_name?: string; stock_uom?: string; item_group?: string }>('Item', r.itemCode),
            erpnextGetDoc<{ custom_pallet_weight?: number; custom_pallet_dims?: string }>('Batch', r.newBatch),
            resolveCustomerPartNo(r.itemCode, { customer: r.customer ?? undefined, salesOrder: soName }),
            resolveSalesOrderPoNo(soName),
          ])
          const zpl = buildPalletZpl({
            itemCode: r.itemCode,
            itemName: item.item_name ?? r.itemCode,
            qty: r.qty,
            uom: item.stock_uom ?? 'pcs',
            batch: r.newBatch,
            salesOrder: soName,
            customerPartNo: custPartNo ?? undefined,
            customerPo: custPo ?? undefined,
            weight: batchDoc?.custom_pallet_weight ? `${batchDoc.custom_pallet_weight} lb` : undefined,
            dimensions: batchDoc?.custom_pallet_dims || undefined,
            brand: brandForItemGroup(item.item_group),
            generatedAt: labelTimestamp(),
            printedBy,
          })
          await supabaseAdmin.from('print_jobs').upsert(
            {
              station_id: station,
              zpl,
              item_code: r.itemCode,
              batch: r.newBatch,
              created_by: userId,
              idempotency_key: `print-${idempotencyKey}-mv-${r.oldBatch}`,
              status: 'pending',
            },
            { onConflict: 'idempotency_key', ignoreDuplicates: true }
          )
        } catch (e) {
          console.error(`move relabel print failed for ${r.newBatch}:`, e)
        }
      }

      return {
        ...committed,
        extra: {
          ...committed.extra,
          relabels: moves.map((m) => ({ oldBatch: m.oldBatch, newBatch: m.newBatch })),
        },
      }
    },
  })

  return NextResponse.json(result.body, { status: result.status })
}
