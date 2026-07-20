import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { addInventory, generatePalletId, reconcileStockEntry, palletBase, getItemInfo, qtyReceive } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp, brandForItemGroup } from '@/lib/erpnext/label'
import { resolveCustomerPartNo, resolveSalesOrderPoNo } from '@/lib/erpnext/customer-part'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { reserveBatchesToSO, reservationsForBatches } from '@/lib/erpnext/staging'
import { flipDashboardStatus } from '@/lib/erpnext/fulfillment-audit'
import { supabaseAdmin } from '@/lib/supabase-admin'

// POST /api/erpnext/inventory/add
// Receives a new pallet into ERPNext AND always creates + enqueues a label.
// Idempotent + resumable via the client-supplied idempotencyKey (a double-tap
// or a timeout-then-retry can never create two receipts).

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_QTY = 10_000_000

interface AddBody {
  itemCode?: string
  qty?: number
  warehouse?: string
  station?: string
  customer?: string
  ref?: string
  salesOrder?: string // optional ERPNext Sales Order to attach (printed on the label)
  weightLb?: number // optional pallet weight (lb) — stored on the Batch + printed
  dims?: string // optional pallet dimensions (LxWxH in) — stored + printed
  idempotencyKey?: string
}

export async function POST(req: NextRequest) {
  const guard = await requireInventoryAccess(req)
  if (!guard.ok) return guard.res

  let body: AddBody
  try {
    body = (await req.json()) as AddBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { itemCode, warehouse, station, customer, ref, idempotencyKey } = body
  const salesOrder = body.salesOrder?.trim() || undefined
  // Customer part number for the label — only when an SO is attached (Simon 2026-07-06).
  // .catch at creation: these may go UNAWAITED (attach failure prints an SO-less label),
  // and an unawaited rejection would be an unhandled promise rejection (gemini review).
  const customerPartNoP = salesOrder && itemCode ? resolveCustomerPartNo(itemCode, { customer, salesOrder }).catch(() => null) : Promise.resolve(null)
  const customerPoP = salesOrder ? resolveSalesOrderPoNo(salesOrder).catch(() => null) : Promise.resolve(null)
  const qty = Number(body.qty)
  // Optional pallet weight/dims (Simon 2026-07-03): stored on the Batch and
  // printed on the label. Dims must be the normalized NxNxN the three-box UI
  // composes — a freeform string would drift across operators.
  const weightLb = Number.isFinite(Number(body.weightLb)) && Number(body.weightLb) > 0
    ? Math.min(99999, Math.round(Number(body.weightLb) * 10) / 10)
    : undefined
  const dimsRaw = body.dims?.trim() || undefined
  if (dimsRaw && !/^\d+(\.\d+)?x\d+(\.\d+)?x\d+(\.\d+)?$/.test(dimsRaw)) {
    return NextResponse.json({ error: 'dims must be LxWxH numbers (e.g. 48x40x60)' }, { status: 400 })
  }
  const dims = dimsRaw
  // Labels attached to a sales order are finished product headed to a customer:
  // weight + dimensions are mandatory for them (Simon 2026-07-03). The client
  // enforces this with a bilingual message; this is the server backstop.
  if (salesOrder && (!weightLb || !dims)) {
    return NextResponse.json(
      { error: 'Finished product labels assigned to a sales order require pallet weight and dimensions.' },
      { status: 400 }
    )
  }
  if (!itemCode || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY || !warehouse || !station || !idempotencyKey) {
    return NextResponse.json(
      { error: 'itemCode, qty (1..10M), warehouse, station, and idempotencyKey are required' },
      { status: 400 }
    )
  }

  // Validate the station before any ERP write.
  const { data: stationRow } = await supabaseAdmin
    .from('print_stations')
    .select('id')
    .eq('id', station)
    .eq('enabled', true)
    .single()
  if (!stationRow) {
    return NextResponse.json({ error: `Unknown or disabled printer station: ${station}` }, { status: 400 })
  }
  if (!(await userCanPrintTo(guard.userId, guard.role, station))) {
    return NextResponse.json({ error: `Not allowed to print to this printer station: ${station}` }, { status: 403 })
  }

  const userId = guard.userId // verified from the session, not a client header
  const printedBy = await resolveUserName(userId)

  // Serialized (pallet) vs non-serialized (quantity) item — decided by ERPNext's batch flag.
  let itemInfo: { itemName: string; uom: string; hasBatch: boolean; piecesPerPack: number; itemGroup: string }
  try {
    itemInfo = await getItemInfo(itemCode)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  // ─── Non-serialized: receive a quantity (boxes) + print one generic label per box ───
  if (!itemInfo.hasBatch) {
    // One label per box. Cap at 10 labels per receive so a fat-finger (e.g. 500) can't
    // flood the printer — the floor receives in small batches, and a bigger receipt is
    // split into multiple adds. (Simon 2026-06-25, all non-serialized items.)
    const MAX_LABELS_PER_RECEIVE = 10
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LABELS_PER_RECEIVE) {
      return NextResponse.json(
        {
          error: `Maximum ${MAX_LABELS_PER_RECEIVE} labels at a time for non-serialized items (one label per box). Split larger receipts.`,
          code: 'max_labels',
          max: MAX_LABELS_PER_RECEIVE,
        },
        { status: 400 }
      )
    }
    const result = await runInventoryOp({
      key: idempotencyKey,
      action: 'add',
      createdBy: userId,
      // No batch/family for a quantity item; family null keeps it outside the pallet lock.
      meta: { item_code: itemCode, qty, warehouse, station_id: station, batch: null, family: null },
      erp: () => qtyReceive({ itemCode, qty, warehouse, opKey: idempotencyKey }),
      reconcile: async () => {
        const se = await reconcileStockEntry(idempotencyKey)
        return se ? { stockEntry: se } : null
      },
      label: async () => {
        // Generic label: part # + label quantity + QR of the PART NUMBER (no unique pallet
        // code). One copy per box (^PQ via `copies`). The label quantity is the item's
        // custom_pieces_per_pack when set, else 1 (a pack is itself one assembly).
        const zpl = buildPalletZpl({
          itemCode,
          itemName: itemInfo.itemName,
          qty: itemInfo.piecesPerPack, // quantity printed on the label (default 1 = one assembly/pack)
          uom: itemInfo.uom,
          batch: '', // no pallet code on a generic label
          qrPayload: itemCode, // scan identifies the product
          copies: qty, // one label per box
          customer,
          ref,
          salesOrder,
          customerPartNo: (await customerPartNoP) ?? undefined,
          customerPo: (await customerPoP) ?? undefined,
          brand: brandForItemGroup(itemInfo.itemGroup),
          generatedAt: labelTimestamp(),
          printedBy,
        })
        const { data: job, error } = await supabaseAdmin
          .from('print_jobs')
          .upsert(
            { station_id: station, zpl, item_code: itemCode, batch: null, created_by: userId, idempotency_key: `print-${idempotencyKey}`, status: 'pending' },
            { onConflict: 'idempotency_key', ignoreDuplicates: true }
          )
          .select('id')
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (job?.id) return job.id
        const { data: existing } = await supabaseAdmin.from('print_jobs').select('id').eq('idempotency_key', `print-${idempotencyKey}`).maybeSingle()
        return existing?.id ?? null
      },
    })
    // Non-serialized items have no reservation concept — an SO here is informational
    // text on the generic label (pre-existing contract). Say so explicitly, so the
    // client's fail-closed serialized check doesn't misread the absence of a staging
    // report as a failed attach (grok review round 3).
    if (salesOrder && result.status >= 200 && result.status < 300) {
      result.body.staging = { attached: false, reserved: 0, staged: false, informational: true }
    }
    return NextResponse.json(result.body, { status: result.status })
  }

  // Pallet id: reuse the one already reserved for this op (a retry), else mint a
  // fresh unique code. Reusing it keeps retries idempotent — addInventory's Batch
  // create is skip-if-exists, and reconcile reports the same id — so a
  // timeout-then-retry can never orphan a second pallet.
  const { data: priorOp } = await supabaseAdmin
    .from('inventory_ops_log')
    .select('batch')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  const batch: string = priorOp?.batch ?? (await generatePalletId())

  // Outcome of the SO-attach attempt made inside the label step. Stays null when the
  // label step doesn't run (replayed op) — the post-op block below then reads the truth
  // from ERPNext instead of guessing.
  type AttachOutcome = {
    attached: boolean
    reserved: number
    staged: boolean
    fullyReservedSoItems: string[]
    warning?: string
  }
  const attachRef: { current: AttachOutcome | null } = { current: null }
  // Set when a retry couldn't refresh an already-enqueued job's ZPL (claimed mid-race
  // or update error) — the physical label may not match the final attach outcome.
  const labelMaybeStaleRef = { current: false }

  // Reserve the pallet's batch to the chosen Sales Order. Returns rather than throws:
  // the label must still print (SO-less) when the order can't take the pallet.
  // Retry-safe via the LIVE state: same SO with the full quantity = attached; a partial
  // bind or another SO is a hard fail — an SO label over a partial reservation would
  // break the whole-pallet invariant (codex review, 2026-07-20).
  const attachToSO = async (soName: string, committedBatch: string): Promise<AttachOutcome> => {
    const none = { attached: false, reserved: 0, staged: false, fullyReservedSoItems: [] }
    try {
      const existing = (await reservationsForBatches([committedBatch]))[committedBatch]
      if (existing) {
        if (existing.so !== soName) {
          return { ...none, warning: `Pallet ${committedBatch} is reserved to ${existing.so}, not ${soName}` }
        }
        if (existing.reservedQty + 1e-6 >= qty) {
          return { attached: true, reserved: 0, staged: false, fullyReservedSoItems: [] }
        }
        return {
          ...none,
          warning: `Pallet ${committedBatch} is only partially reserved to ${soName} (${existing.reservedQty} of ${qty}) — fix it in Prepare for staging`,
        }
      }
    } catch {
      // Lookup failure: fall through to a fresh reserve attempt, which decides for real.
    }
    try {
      const r = await reserveBatchesToSO({
        soName,
        items: [{ itemCode, warehouse, batch: committedBatch, qty }],
      })
      return { attached: true, reserved: r.reserved, staged: r.staged, fullyReservedSoItems: r.fullyReservedSoItems }
    } catch (e) {
      // The attempt may have committed before a timeout — reconcile against the live
      // state before declaring failure, so a bound reservation is never reported (and
      // labeled) as unattached.
      try {
        const now = (await reservationsForBatches([committedBatch]))[committedBatch]
        if (now?.so === soName && now.reservedQty + 1e-6 >= qty) {
          return { attached: true, reserved: 0, staged: false, fullyReservedSoItems: [] }
        }
      } catch {
        // Keep the original reserve error.
      }
      return { ...none, warning: e instanceof Error ? e.message : String(e) }
    }
  }

  const result = await runInventoryOp({
    key: idempotencyKey,
    action: 'add',
    createdBy: userId,
    meta: { item_code: itemCode, qty, warehouse, station_id: station, batch, family: palletBase(batch) },
    erp: () => addInventory({ itemCode, qty, warehouse, opKey: idempotencyKey, batch, weightLb, dims }),
    reconcile: async () => {
      const se = await reconcileStockEntry(idempotencyKey)
      return se ? { batch, stockEntry: se } : null
    },
    label: async (committed) => {
      // Attach BEFORE printing — a label naming a Sales Order must only exist if the
      // reservation actually bound. The old order (print, then best-effort reserve)
      // produced a label that read "SO-00135" on a pallet the order never got: the
      // DQ0N incident, 2026-07-16 — the line sat Work in Progress for 4 days while
      // the floor believed it was staged.
      if (salesOrder) {
        attachRef.current = await attachToSO(salesOrder, committed.batch ?? batch)
      }
      const attachedSo = attachRef.current?.attached ? salesOrder : undefined
      const zpl = buildPalletZpl({
        itemCode,
        itemName: itemInfo.itemName,
        qty,
        uom: itemInfo.uom,
        batch: committed.batch ?? batch,
        customer,
        ref,
        salesOrder: attachedSo,
        customerPartNo: attachedSo ? ((await customerPartNoP) ?? undefined) : undefined,
        customerPo: attachedSo ? ((await customerPoP) ?? undefined) : undefined,
        weight: weightLb ? `${weightLb} lb` : undefined,
        dimensions: dims,
        brand: brandForItemGroup(itemInfo.itemGroup),
        generatedAt: labelTimestamp(),
        printedBy,
      })
      const { data: job, error } = await supabaseAdmin
        .from('print_jobs')
        .upsert(
          {
            station_id: station,
            zpl,
            item_code: itemCode,
            batch: committed.batch ?? batch,
            created_by: userId,
            idempotency_key: `print-${idempotencyKey}`,
            status: 'pending',
          },
          // Insert-or-IGNORE: a retry with the same key must never reset an
          // already-claimed/printed job back to pending (would reprint it).
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (job?.id) return job.id
      // Conflict (job already queued): recover its id so the op log keeps the link.
      // If the job is STILL PENDING, refresh its ZPL — a resumed op can reach a
      // different attach outcome than the crashed attempt that enqueued it, and the
      // physical label must match the final outcome (grok review). Claimed/printed
      // jobs are never touched (that would reprint them); when the refresh loses that
      // race (0 rows) or errors, the possibly-stale label is flagged for reprint
      // below instead of silently finalizing (codex/grok round-3).
      const { data: refreshed, error: refreshErr } = await supabaseAdmin
        .from('print_jobs')
        .update({ zpl })
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .eq('status', 'pending')
        .select('id')
      if (refreshErr || (refreshed?.length ?? 0) === 0) labelMaybeStaleRef.current = true
      const { data: existing } = await supabaseAdmin
        .from('print_jobs')
        .select('id')
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .maybeSingle()
      return existing?.id ?? null
    },
  })

  // Report the attach outcome. `attached: false` is rendered by the client as a loud
  // error (the label printed WITHOUT the order) — never bury it in a 200 again.
  if (salesOrder && result.status >= 200 && result.status < 300) {
    const attach = attachRef.current
    if (attach) {
      result.body.staging = {
        attached: attach.attached,
        reserved: attach.reserved,
        staged: attach.staged,
        ...(attach.warning ? { warning: attach.warning } : {}),
      }
      // Backward-compat loud-ish signal for STALE OPEN TABS (pre-deploy client bundles
      // on long-lived floor kiosks never read `staging`): labelPending is a field old
      // clients already render ("label pending - reprint"). It is also the literally
      // correct instruction — after attaching in Prepare for staging, Reprint produces
      // the full SO label (codex round-3 BLOCK). Same flag when a retry may have left a
      // stale ZPL in the queue.
      if (!attach.attached || labelMaybeStaleRef.current) {
        result.body.labelPending = true
      }
      // Instant status flip for the lines this pallet fully covered — the
      // 5-min sync reaches the same answer, this just kills the lag window
      // (SO-00077 release 2 read Pending for minutes after staging, 2026-07-06).
      if (attach.attached && attach.fullyReservedSoItems.length > 0) {
        // flipDashboardStatus never throws (internal catch); awaited so a serverless
        // freeze after the response can't drop the update (gemini review).
        await flipDashboardStatus(salesOrder, 'staged', attach.fullyReservedSoItems)
      }
    } else {
      // Replayed op — the label step didn't run, so report the live reservation state.
      // A lookup outage is reported as "could not verify", not as a confident
      // "not attached" (grok/gemini review) — still fail-closed on the client.
      const committedBatch = (result.body?.batch as string | undefined) ?? batch
      try {
        const existing = (await reservationsForBatches([committedBatch]))[committedBatch]
        result.body.staging =
          existing?.so === salesOrder && existing.reservedQty + 1e-6 >= qty
            ? { attached: true, reserved: 0, staged: false }
            : {
                attached: false,
                reserved: 0,
                staged: false,
                warning: existing
                  ? existing.so === salesOrder
                    ? `Pallet ${committedBatch} is only partially reserved to ${salesOrder} (${existing.reservedQty} of ${qty})`
                    : `Pallet ${committedBatch} is reserved to ${existing.so}, not ${salesOrder}`
                  : `Pallet ${committedBatch} is not attached to ${salesOrder}`,
              }
      } catch {
        result.body.staging = {
          attached: false,
          reserved: 0,
          staged: false,
          warning: `Could not verify the attachment of ${committedBatch} to ${salesOrder} — check it in Prepare for staging`,
        }
      }
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}
