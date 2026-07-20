import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { reserveBatchesToSO, reservationsForBatches, releaseBatchReservation } from '@/lib/erpnext/staging'
import { reserveNextSerial, reissuePallet, getBatchLocation, assertBatchItem } from '@/lib/erpnext/inventory'
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
  // Per pallet, `sre` = the reservation the CLIENT showed the operator (from
  // the reservations lookup). The move plan binds to it: if the live
  // reservation differs at plan time, the request 409s instead of releasing a
  // reservation nobody confirmed (codex round-6).
  pallets?: { batch?: string; itemCode?: string; warehouse?: string; qty?: number; sre?: string }[]
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
      sre: p.sre?.trim() || undefined,
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
  // sre pins the EXACT reservation the operator confirmed releasing — the
  // destructive phase must not cancel whatever the batch happens to carry by
  // then (codex round-4). Optional for plans stored before this field existed.
  type MovePlan = { oldBatch: string; newBatch: string; fromSo: string; customer: string | null; itemCode: string; qty: number; sre?: string }
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('item_code')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  let moves: MovePlan[]
  if (priorOp?.item_code) {
    try {
      const stored = JSON.parse(priorOp.item_code) as { relabels?: MovePlan[]; batches?: string[] }
      moves = stored.relabels ?? []
      // Rebuild pallet quantities from the STORED canonical identity, never the
      // retry body: the fresh run canonicalized qtys from ERPNext, and a replay
      // recomputing the fingerprint from client values 409'd the exact
      // resume-after-partial-move this plan exists to survive (grok round-9).
      // Doubles as the tamper guard — a crafted retry body can't change what
      // gets reserved (codex round-8).
      const storedQty = new Map<string, number>()
      for (const s of stored.batches ?? []) {
        const i = s.lastIndexOf(':')
        if (i > 0) storedQty.set(s.slice(0, i), Number(s.slice(i + 1)))
      }
      for (const p of pallets) {
        const q = storedQty.get(p.batch)
        if (q != null && Number.isFinite(q) && q > 0) p.qty = q
      }
    } catch {
      moves = []
    }
    // A stored plan that predates reservation pinning has no sre — replaying it
    // would release whatever the batch carries NOW, unconfirmed. Fail the
    // replay cleanly; the operator re-scans and gets a fresh pinned plan
    // (codex round-8).
    if (moves.some((m) => !m.sre)) {
      return NextResponse.json(
        { error: 'This staging attempt predates a safety upgrade — re-scan the pallets and try again' },
        { status: 409 }
      )
    }
  } else {
    // Canonicalize each pallet's facts from ERPNext before ANY planning — the
    // client's qty/warehouse are display data. A stale or crafted qty would
    // otherwise become reissuePallet's target on a move (inventory create/
    // delete) or reserve part of a physical pallet while the whole-pallet check
    // passes against the claimed number (codex round-7). Replays skip this:
    // their moved source batches are already drained, and the stored plan
    // carries the canonical quantities.
    try {
      for (const p of pallets) {
        await assertBatchItem(p.batch, p.itemCode)
        const loc = await getBatchLocation(p.batch, p.itemCode)
        if (!loc || !(loc.qty > 0)) {
          return NextResponse.json({ error: `Pallet ${p.batch} has no on-hand stock` }, { status: 400 })
        }
        if (loc.split) {
          return NextResponse.json(
            { error: `Pallet ${p.batch} is split across bins — consolidate it before staging` },
            { status: 400 }
          )
        }
        p.qty = loc.qty
        p.warehouse = loc.warehouse
      }
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
    }
    const existing = await reservationsForBatches(pallets.map((p) => p.batch))
    const conflicts = pallets
      .map((p) => ({ p, r: existing[p.batch] }))
      // A conflict is a reservation to another ORDER, or — when a target line is
      // picked — to another LINE of the same order: a line-level restage must go
      // through the move flow (release + reissue + relabel) so the printed line
      // number never lies (codex review 2026-07-20). A reservation whose line is
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
          error: 'Some pallets are reserved to another order or line',
          moves: conflicts.map(({ r }) => ({ batch: r.batch, so: r.so, soItem: r.soItem, customer: r.customer })),
        },
        { status: 409 }
      )
    }
    // The reservation being moved must be the one the OPERATOR was shown when
    // they confirmed — REQUIRED, not optional: a reservation that appeared
    // after the client's scan arrives with no sre and would otherwise ride an
    // allowMove=true request into release without ever being in the confirm
    // dialog (codex round-12). Pre-upgrade tabs that can't send sre get a clean
    // 409 and recover by refreshing.
    const drifted = conflicts.filter(({ p, r }) => !p.sre || p.sre !== r.sre)
    if (drifted.length > 0) {
      return NextResponse.json(
        {
          error:
            'Some pallet reservations changed since they were scanned — remove and re-scan them (or refresh the page)',
          moves: drifted.map(({ r }) => ({ batch: r.batch, so: r.so, soItem: r.soItem, customer: r.customer })),
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
      // Whole-queue capacity: only pallets already FULLY reserved on this line
      // don't count (a partial reservation still needs a real reserve pass).
      const newPcs = pallets
        .filter((p) => {
          const r = existing[p.batch]
          return !(r && r.soItem === salesOrderItem && r.reservedQty + 1e-6 >= p.qty)
        })
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
        sre: r.sre,
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
    // batch:qty pairs (canonical qtys on the fresh run) — a same-key retry with
    // altered quantities mismatches and is rejected instead of replaying with
    // the tampered numbers past the whole-pallet check (codex round-8).
    batches: [...new Set(pallets.map((p) => `${p.batch}:${p.qty}`))].sort(),
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

      // LIVE destination check BEFORE any release/reissue — on fresh runs AND
      // replays (the 400-preflight only runs on fresh requests). A closed/
      // cancelled order or a vanished target line must fail here, not after the
      // source reservations are gone and the pallets renamed (codex round-3).
      const soLive = await erpnextGetDoc<{
        docstatus: number
        status: string
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
      if (soLive.docstatus !== 1 || ['Completed', 'Closed', 'Cancelled', 'On Hold'].includes(soLive.status)) {
        throw new Error(`Sales Order ${soName} is not open (status ${soLive.status})`)
      }
      // Live reservations BEFORE the moves — feeds the capacity re-check and the
      // per-move SRE pin verification below. Includes the move plan's NEW batch
      // codes: a retry after a partial run finds the reissued pallet already
      // reserved and must not count it as new demand (codex round-5 — that
      // deadlocked the retry permanently). FAIL-CLOSED when moves exist: with a
      // destructive plan ahead, an unreadable reservation state must stop the op.
      let liveBefore: Awaited<ReturnType<typeof reservationsForBatches>>
      try {
        liveBefore = await reservationsForBatches([
          ...pallets.map((p) => p.batch),
          ...moves.map((m) => m.newBatch),
        ])
      } catch {
        if (moves.length > 0) {
          throw new Error('Could not verify current reservations before the move — nothing was changed, try again')
        }
        liveBefore = {}
      }
      // A pallet's reservation may live under its ORIGINAL code or, after a
      // partial run, under its reissued move code.
      const liveOf = (batch: string) => {
        const mv = moves.find((m) => m.oldBatch === batch)
        return liveBefore[batch] ?? (mv ? liveBefore[mv.newBatch] : undefined)
      }
      if (salesOrderItem) {
        const pinLive = (soLive.items ?? []).find((l) => l.name === salesOrderItem)
        if (!pinLive || !pinLive.reserve_stock || pallets.some((p) => p.itemCode !== pinLive.item_code)) {
          throw new Error(
            `Sales Order ${soName} has no reservable line ${salesOrderItem} for the queued part — refresh and pick the line again`
          )
        }
        // Capacity re-check IMMEDIATELY before the destructive phase — a
        // concurrent reservation between preflight and here must fail the op
        // while the source reservations still exist (codex round-4).
        const needPcs = pallets
          .filter((p) => {
            const r = liveOf(p.batch)
            return !(r && r.so === soName && r.soItem === salesOrderItem && r.reservedQty + 1e-6 >= p.qty)
          })
          .reduce((s, p) => s + p.qty, 0)
        const remainingLive =
          (Number(pinLive.stock_qty ?? pinLive.qty) || 0) -
          Math.max(Number(pinLive.stock_reserved_qty) || 0, Number(pinLive.delivered_qty) || 0)
        if (needPcs > remainingLive + 1e-6) {
          throw new Error(
            `That line only needs ${Math.max(0, remainingLive).toLocaleString()} more — the queue holds ${needPcs.toLocaleString()}. Nothing was changed.`
          )
        }
      }

      // Every reservation being released must be the ONE the operator confirmed
      // (pinned by SRE name) and must cover ONLY its pallet — both checked for
      // the WHOLE plan before releasing anything, so "nothing was changed"
      // stays true on failure (bundled-SRE check hoisted out of the destructive
      // loop, codex round-8).
      for (const m of moves) {
        const cur = liveBefore[m.oldBatch]
        if (cur && m.sre && cur.sre !== m.sre) {
          throw new Error(
            `Pallet ${m.oldBatch}'s reservation changed since the move was confirmed — re-scan and try again. Nothing was changed.`
          )
        }
        if (cur && m.sre) {
          const sreDoc = await erpnextGetDoc<{ sb_entries?: { batch_no?: string | null }[] }>(
            'Stock Reservation Entry',
            m.sre
          )
          const batchCount = new Set(
            (sreDoc.sb_entries ?? []).map((e) => String(e.batch_no ?? '').trim()).filter(Boolean)
          ).size
          if (batchCount > 1) {
            throw new Error(
              `Pallet ${m.oldBatch}'s reservation covers ${batchCount} pallets — it must be handled in ERPNext directly. Nothing was changed.`
            )
          }
        }
      }

      for (const m of moves) {
        const entry = pallets.find((p) => p.batch === m.oldBatch)
        // Pinned release: only the SRE the operator confirmed may be cancelled
        // (releaseBatchReservation throws on a changed reservation).
        const rel = await releaseBatchReservation(m.oldBatch, m.sre)
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
      // Skip ONLY a FULL reservation on the target — a partial one must go
      // through reserveBatchesToSO so the whole-pallet rule can reject it
      // (codex round-3: skipping partials bypassed that check).
      const toReserve = pallets.filter((p) => {
        const r = live[p.batch]
        return !(
          r &&
          r.so === soName &&
          (!salesOrderItem || r.soItem === salesOrderItem) &&
          r.reservedQty + 1e-6 >= p.qty
        )
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
      // A replayed op may find a moved batch already reserved (absent from this
      // run's allocations) — fall back to the live reservation's line (codex
      // round-3), then to the explicit target.
      const moveSoItemOf = (batch: string): string | undefined =>
        committed.allocations[batch] ?? live[batch]?.soItem ?? salesOrderItem
      const moveLineNos = await dashboardLinesForSoItems(
        moves.map((m) => moveSoItemOf(m.newBatch)).filter((v): v is string => !!v)
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
              const soItem = moveSoItemOf(r.newBatch)
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
