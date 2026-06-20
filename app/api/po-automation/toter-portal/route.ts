import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
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
  created_at: string
}

const SELECT_COLS = 'id, line, if_number, po_number, customer, status, shipment_number, entered_at, created_at'

async function gate(req: NextRequest): Promise<NextResponse | string> {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessPoAutomation(userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return userId
}

/**
 * Find the most recent entry for an order. `line` is the primary per-order key
 * (multiple lines can share one IF#); `if` is a fallback for legacy callers.
 */
async function latestEntry(line: string, ifNumber: string): Promise<ToterEntryRow | null> {
  let query = supabaseAdmin.schema(SCHEMA).from(TABLE).select(SELECT_COLS)
  if (line) query = query.eq('line', line)
  else if (ifNumber) query = query.eq('if_number', ifNumber)
  else return null

  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  return (data as ToterEntryRow | null) ?? null
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

  const entry = await latestEntry(line, ifNumber)
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
  const customer = (body.customer ?? '').trim()

  if (!isToterCustomer(customer)) {
    return NextResponse.json({ error: 'Not a Toter order' }, { status: 400 })
  }
  if (!line && !ifNumber) {
    return NextResponse.json({ error: 'Missing order line / IF number' }, { status: 400 })
  }

  // Idempotency: reuse an existing active or entered request for this order.
  const existing = await latestEntry(line, ifNumber)
  if (existing && (existing.status === 'entered' || (TOTER_ACTIVE_STATUSES as readonly string[]).includes(existing.status))) {
    return NextResponse.json({ entry: existing, reused: true })
  }

  const actor = await resolvePoActor(userId)
  const { data, error } = await supabaseAdmin
    .schema(SCHEMA)
    .from(TABLE)
    .insert({
      line: line || null,
      if_number: ifNumber || null,
      po_number: poNumber || null,
      customer: customer || null,
      status: 'queued',
      requested_by: userId,
      requested_by_name: actor.name,
    })
    .select(SELECT_COLS)
    .single()

  if (error) {
    console.error('toter-portal enqueue failed:', error)
    return NextResponse.json({ error: 'Failed to enqueue Toter entry' }, { status: 500 })
  }

  return NextResponse.json({ entry: data as ToterEntryRow })
}
