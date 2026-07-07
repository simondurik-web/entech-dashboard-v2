import { NextRequest, NextResponse } from 'next/server'
import { requireInventoryAccess } from '@/lib/erpnext/auth'
import { userCanPrintTo } from '@/lib/erpnext/printer-access'
import { addInventory, generatePalletId, reconcileStockEntry, palletBase, getItemInfo, qtyReceive } from '@/lib/erpnext/inventory'
import { buildPalletZpl, labelTimestamp, brandForItemGroup } from '@/lib/erpnext/label'
import { resolveCustomerPartNo, resolveSalesOrderPoNo } from '@/lib/erpnext/customer-part'
import { erpnextGetDoc } from '@/lib/erpnext/client'
import { runInventoryOp, resolveUserName } from '@/lib/erpnext/operation'
import { reserveBatchesToSO } from '@/lib/erpnext/staging'
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
  const customerPartNoP = salesOrder && itemCode ? resolveCustomerPartNo(itemCode, { customer, salesOrder }) : Promise.resolve(null)
  const customerPoP = salesOrder ? resolveSalesOrderPoNo(salesOrder) : Promise.resolve(null)
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
      const zpl = buildPalletZpl({
        itemCode,
        itemName: itemInfo.itemName,
        qty,
        uom: itemInfo.uom,
        batch: committed.batch ?? batch,
        customer,
        ref,
        salesOrder,
        customerPartNo: (await customerPartNoP) ?? undefined,
        customerPo: (await customerPoP) ?? undefined,
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
      const { data: existing } = await supabaseAdmin
        .from('print_jobs')
        .select('id')
        .eq('idempotency_key', `print-${idempotencyKey}`)
        .maybeSingle()
      return existing?.id ?? null
    },
  })

  // If the operator picked a Sales Order while adding this pallet, reserve the pallet's batch
  // to that order (the "label + select SO" staging path — mirrors the "Prepare for staging"
  // tab). Best-effort: the pallet + label already succeeded, so a reservation hiccup must not
  // fail the request. Idempotent by nature — a retry re-reserving an already-reserved batch
  // hits ERPNext's available-to-reserve cap and is reported as a warning, never a double-lock.
  if (salesOrder && result.status >= 200 && result.status < 300) {
    const committedBatch = (result.body?.batch as string | undefined) ?? batch
    try {
      const r = await reserveBatchesToSO({
        soName: salesOrder,
        items: [{ itemCode, warehouse, batch: committedBatch, qty }],
      })
      result.body.staging = { reserved: r.reserved, staged: r.staged }
      // Instant status flip for the lines this pallet fully covered — the
      // 5-min sync reaches the same answer, this just kills the lag window
      // (SO-00077 release 2 read Pending for minutes after staging, 2026-07-06).
      if (r.fullyReservedSoItems.length > 0) {
        flipDashboardStatus(salesOrder, 'staged', r.fullyReservedSoItems)
      }
    } catch (e) {
      result.body.staging = { reserved: 0, staged: false, warning: (e as Error).message }
    }
  }

  return NextResponse.json(result.body, { status: result.status })
}
