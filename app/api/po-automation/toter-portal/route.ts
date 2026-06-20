import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeStatus } from '@/lib/google-sheets'
import { canAccessPoAutomation } from '@/lib/po-automation/guard'
import { resolvePoActor } from '@/lib/po-automation/edit'
import { isToterCustomer, TOTER_ACTIVE_STATUSES, type ToterEntryStatus } from '@/lib/po-automation/toter'

export const dynamic = 'force-dynamic'

const SCHEMA = 'po_automation'
const TABLE = 'toter_portal_entries'

type ToterEntryRow = {
  id: string
  line: string | null
  if_number: string | null
  po_number: string | null
  customer: string | null
  status: ToterEntryStatus
  shipment_number: string | null
  entered_at: string | null
  error: string | null
  created_at: string
}

const SELECT_COLS = 'id, line, if_number, po_number, customer, status, shipment_number, entered_at, error, created_at'

async function gate(req: NextRequest): Promise<NextResponse | string> {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPoAutomation(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return userId
}

/**
 * Find the most recent entry for an order. Keyed by IF# first — the downstream
 * Toter skill is per-IF# (one IF# = one portal shipment), and a dashboard order
 * can have multiple lines sharing that IF#, so dedup/lookup MUST be by IF# to
 * avoid double freight bookings. `line` is only a fallback. Returns
 * `{ entry, errored }` so callers can fail closed when the lookup itself errors
 * (otherwise a flaky DB read would silently bypass idempotency).
 */
async function latestEntry(
  ifNumber: string,
  line: string,
): Promise<{ entry: ToterEntryRow | null; errored: boolean }> {
  let query = supabaseAdmin.schema(SCHEMA).from(TABLE).select(SELECT_COLS)
  if (ifNumber) query = query.eq('if_number', ifNumber)
  else if (line) query = query.eq('line', line)
  else return { entry: null, errored: false }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return { entry: null, errored: true }
  return { entry: (data as ToterEntryRow | null) ?? null, errored: false }
}

/**
 * GET /api/po-automation/toter-portal?line=&if=  — current entry state for an
 * order, so the Ready-to-Ship card can render the right button (Enter vs.
 * Requested vs. Order entered). Returns { entry: row | null }.
 */
export async function GET(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated

  const sp = new URL(req.url).searchParams
  const line = (sp.get('line') ?? '').trim()
  const ifNumber = (sp.get('if') ?? '').trim()
  if (!line && !ifNumber) return NextResponse.json({ entry: null })

  const { entry, errored } = await latestEntry(ifNumber, line)
  if (errored) return NextResponse.json({ error: 'Lookup failed' }, { status: 503 })
  return NextResponse.json({ entry })
}

/**
 * POST /api/po-automation/toter-portal  — enqueue a Toter portal-entry request
 * for an order. Body: { line, ifNumber, poNumber, customer }.
 *
 * Idempotent: if an active (queued/notified/running) or already-entered request
 * exists for the order line, returns it unchanged instead of enqueuing a
 * duplicate. Only Toter/Wastequip customers are accepted (defense in depth — the
 * button is only shown for Toter orders client-side).
 */
export async function POST(req: NextRequest) {
  const gated = await gate(req)
  if (gated instanceof NextResponse) return gated
  const userId = gated

  let body: { line?: string; ifNumber?: string; poNumber?: string; customer?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const line = (body.line ?? '').trim()
  const ifNumber = (body.ifNumber ?? '').trim()
  const poNumber = (body.poNumber ?? '').trim()

  if (!line && !ifNumber) {
    return NextResponse.json({ error: 'Missing order line / IF number' }, { status: 400 })
  }

  // Validate the order server-side against dashboard_orders rather than trusting
  // the request body: it must exist, be a Toter/Wastequip order, and be staged.
  // Customer / PO / IF# are taken from the DB row so a permitted caller can't
  // enqueue arbitrary or non-Toter work by spoofing the body.
  let orderQuery = supabaseAdmin
    .from('dashboard_orders')
    .select('line, if_number, po_number, customer, work_order_status, if_status_fusion')
  orderQuery = line ? orderQuery.eq('line', line) : orderQuery.eq('if_number', ifNumber)
  const { data: orderRow, error: orderErr } = await orderQuery.limit(1).maybeSingle()
  if (orderErr) return NextResponse.json({ error: 'Lookup failed, try again' }, { status: 503 })
  if (!orderRow) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const dbCustomer = (orderRow.customer ?? '').trim()
  const dbIf = (orderRow.if_number ?? '').trim() || ifNumber
  const dbPo = (orderRow.po_number ?? '').trim() || poNumber

  if (!isToterCustomer(dbCustomer)) {
    return NextResponse.json({ error: 'Not a Toter order' }, { status: 400 })
  }
  // IF# is required — it is the sole key the downstream Toter skill runs on.
  if (!dbIf) {
    return NextResponse.json({ error: 'Order has no IF number' }, { status: 400 })
  }
  if (normalizeStatus(orderRow.work_order_status ?? '', orderRow.if_status_fusion ?? '') !== 'staged') {
    return NextResponse.json({ error: 'Order is not staged' }, { status: 400 })
  }

  // Idempotency (keyed by IF#): reuse an existing active or entered request.
  // Fail closed if the lookup itself errored, so a flaky read can't bypass dedup
  // and let claude-5 book the same freight twice.
  const { entry: existing, errored } = await latestEntry(dbIf, line)
  if (errored) {
    return NextResponse.json({ error: 'Lookup failed, try again' }, { status: 503 })
  }
  if (existing && (existing.status === 'entered' || (TOTER_ACTIVE_STATUSES as readonly string[]).includes(existing.status))) {
    return NextResponse.json({ entry: existing, reused: true })
  }

  const actor = await resolvePoActor(userId)
  const { data, error } = await supabaseAdmin
    .schema(SCHEMA)
    .from(TABLE)
    .insert({
      line: line || null,
      if_number: dbIf,
      po_number: dbPo || null,
      customer: dbCustomer || null,
      status: 'queued',
      requested_by: userId,
      requested_by_name: actor.name,
    })
    .select(SELECT_COLS)
    .single()

  if (error) {
    // 23505 = the partial unique index fired (a concurrent click already
    // enqueued/entered this IF#). Treat as reuse, not an error.
    if ((error as { code?: string }).code === '23505') {
      const { entry: raced } = await latestEntry(dbIf, line)
      if (raced) return NextResponse.json({ entry: raced, reused: true })
    }
    console.error('toter-portal enqueue failed:', error)
    return NextResponse.json({ error: 'Failed to enqueue Toter entry' }, { status: 500 })
  }

  return NextResponse.json({ entry: data as ToterEntryRow })
}
