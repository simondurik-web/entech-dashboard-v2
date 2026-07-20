import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { reserveBatchesToSO, reservationsForBatches, releaseBatchReservation } from '@/lib/erpnext/staging'
import { reserveNextSerial, reissuePallet } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp, brandForItemGroup } from '@/lib/erpnext/label'
import { resolveCustomerPartNo, resolveSalesOrderPoNo } from '@/lib/erpnext/customer-part'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { logFulfillment, flipDashboardStatus, dashboardLinesForSoItems } from '@/lib/erpnext/fulfillment-audit'
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
  // Release line (SO Item child name) to reserve the whole queue against. The
  // operator picks a LINE, not an order — the line number is the floor's unique
  // handle (Simon 2026-07-20). Omitted -> soonest-due auto-allocation.
  salesOrderItem?: string
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
  const salesOrderItem = body.salesOrderItem?.trim() || undefined
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
      // A conflict is a reservation to another ORDER, or — when a target line is
      // picked — to another LINE of the same order (a line-level restage must go
      // through the move flow: release + reissue + relabel, so the printed line
      // number never lies; codex review 2026-07-20). Same order + same line (or
      // no line picked) stays a harmless no-op re-reserve.
      // number never lies; codex review 2026-07-20). A reservation whose line is
      // UNKNOWN (soItem null) fails closed into the move flow too — it must not
      // be credited to the picked line. Same order + same line (or no line
      // picked) is dropped from the reserve list inside erp() instead.
      .filter(
        (x): x is { p: (typeof pallets)[number]; r: NonNullable<(typeof existing)[string]> } =>
          !!x.r &&
          (x.r.so !== soName || (!!salesOrderItem && x.r.soItem !== salesOrderItem))
      )
    if (conflicts.length > 0 && !body.allowMove) {
      return NextResponse.json(
        {
          error: 'Some pallets are reserved to another order',
          moves: conflicts.map(({ r }) => ({ batch: r.batch, so: r.so, customer: r.customer })),
        },
        { status: 409 }
      )
    }
    // With an explicit target line, validate it BEFORE anything destructive — a
    // move releases reservations and reissues pallet codes; a stale dropdown or
    // crafted line must die here as a clean 400, not mid-flight with the old
    // reservations already gone (codex round-2 BLOCKER). reserveBatchesToSO
    // re-validates authoritatively inside the op; this closes the common case.
    if (salesOrderItem) {
      const soDoc = await erpnextGetDoc<{
        items?: {
          name: string
          item_code: string
          qty: number
          stock_qty?: number | null
          stock_reserved_qty?: number | null
          delivered_qty?: number | null
          reserve_stock?: number | null
        }[]
      }>('Sales Order', soName)
      const pin = (soDoc.items ?? []).find((l) => l.name === salesOrderItem)
      if (!pin || !pin.reserve_stock || pallets.some((p) => p.itemCode !== pin.item_code)) {
        return NextResponse.json(
          { error: `Sales Order ${soName} has no reservable line ${salesOrderItem} for the queued part — refresh and pick the line again` },
          { status: 400 }
        )
      }
      // Whole-queue capacity: pallets already sitting on this line don't count.
      const newPcs = pallets
        .filter((p) => existing[p.batch]?.soItem !== salesOrderItem)
        .reduce((s, p) => s + p.qty, 0)
      const remaining =
        (Number(pin.stock_qty ?? pin.qty) || 0) -
        Math.max(Number(pin.stock_reserved_qty) || 0, Number(pin.delivered_qty) || 0)
      if (newPcs > remaining + 1e-6) {
        return NextResponse.json(
          { error: `That line only needs ${Math.max(0, remaining).toLocaleString()} more — the queue holds ${newPcs.toLocaleString()}` },
          { status: 400 }
        )
      }
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
    // Target release line is part of the op identity: the same pallet set aimed
    // at a different line is a different operation, not a retry.
    ...(salesOrderItem ? { soItem: salesOrderItem } : {}),
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
        const rel = await releaseBatchReservation(m.oldBatch)
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

      // Live truth AFTER the moves ran: drop pallets whose reservation already
      // sits on the target (same SO; same line when one is picked). Re-reserving
      // them binds nothing in ERPNext yet double-counts the line's coverage,
      // which could flip a line staged without a real reservation (codex round
      // 2). Lookup failure falls back to the full list — the wrong-line
      // backstop inside reserveBatchesToSO still holds.
      const live = await reservationsForBatches(pallets.map((p) => p.batch)).catch(
        () => ({}) as Awaited<ReturnType<typeof reservationsForBatches>>
      )
      const toReserve = pallets.filter((p) => {
        const r = live[p.batch]
        return !(r && r.so === soName && (!salesOrderItem || r.soItem === salesOrderItem))
      })
      const committed = await reserveBatchesToSO({
        soName,
        items: toReserve.map((p) => ({ ...p, salesOrderItem })),
      })

      // Instant status flip for the lines these pallets fully covered — the
      // 5-min sync reaches the same answer, this just kills the lag window
      // (SO-00077 release 2 read Pending for minutes after staging, 2026-07-06).
      if (committed.fullyReservedSoItems.length > 0) {
        flipDashboardStatus(soName, 'staged', committed.fullyReservedSoItems)
      }

      // Fresh labels for the moved pallets, printed with the NEW order on them.
      // Line numbers for the labels: which release line each moved batch bound to.
      const moveLineNos = await dashboardLinesForSoItems(
        moves.map((m) => committed.allocations[m.newBatch]).filter(Boolean)
      )
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
            lineNo: (() => {
              const soItem = committed.allocations[r.newBatch]
              const n = soItem ? moveLineNos[soItem] : undefined
              return n != null ? String(n) : undefined
            })(),
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
