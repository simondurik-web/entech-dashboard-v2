import { supabaseAdmin } from '@/lib/supabase-admin'

// Load log + instant status flip for the fulfillment wrapper (Simon 2026-07-03):
// every ship/undo/sign/upload is recorded for traceability, and the dashboard
// row hops between Ready to Ship / Shipped immediately instead of waiting for
// the 5-minute ERPNext sync. Both are best-effort side effects — a logging or
// flip failure must never fail the shipment action itself (the sync remains
// the source of truth and self-heals the row within minutes).

export type FulfillmentAction =
  | 'complete'
  | 'undo'
  | 'sign_bol'
  | 'sign_external_bol'
  | 'set_pro_number'
  | 'upload_customer_bol'
  | 'print_document'
  | 'move_reservation'
  // truckloads (Simon 2026-07-08): create/edit/cancel a linked load, and the
  // manager override that releases one order to ship alone
  | 'tl_create'
  | 'tl_edit'
  | 'tl_cancel'
  | 'tl_release'

export interface FulfillmentLogEntry {
  action: FulfillmentAction
  so: string
  dn: string
  customer?: string | null
  pallets?: string[]
  userId?: string | null
  userName?: string | null
  detail?: string | null
}

export async function logFulfillment(entry: FulfillmentLogEntry): Promise<void> {
  try {
    await supabaseAdmin.from('fulfillment_log').insert({
      action: entry.action,
      so_number: entry.so,
      dn_number: entry.dn,
      customer: entry.customer ?? null,
      pallets: entry.pallets ?? null,
      user_id: entry.userId ?? null,
      user_name: entry.userName ?? null,
      detail: entry.detail ?? null,
    })
  } catch (e) {
    console.error('fulfillment_log insert failed:', e)
  }
}

export interface FulfillmentLogRow {
  id: number
  created_at: string
  action: FulfillmentAction
  dn_number: string
  user_name: string | null
  detail: string | null
}

export async function listFulfillmentLog(so: string): Promise<FulfillmentLogRow[]> {
  const { data } = await supabaseAdmin
    .from('fulfillment_log')
    .select('id, created_at, action, dn_number, user_name, detail')
    .eq('so_number', so)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data ?? []) as FulfillmentLogRow[]
}

/** Dashboard line numbers for Sales Order Item child names, via erp_order_line_map.
 *  The line number is the floor's unique handle for a release (it's on the packing
 *  sheet); ERPNext doesn't know it, only the map does. Missing/unmapped items are
 *  simply absent from the result. */
export async function dashboardLinesForSoItems(soItems: string[]): Promise<Record<string, number>> {
  const uniq = [...new Set(soItems.filter(Boolean))]
  if (uniq.length === 0) return {}
  try {
    const { data, error } = await supabaseAdmin
      .from('erp_order_line_map')
      .select('erp_so_item_name, line')
      .in('erp_so_item_name', uniq)
    // supabase-js reports failures via `error`, it rarely throws — an ignored
    // error would silently drop every line number (gemini/codex review).
    if (error) {
      console.error('dashboard line lookup failed:', error)
      return {}
    }
    // Only sane positive line numbers — a NaN/0 row must not print "Line NaN"
    // on a physical label (grok round-4).
    return Object.fromEntries(
      (data ?? [])
        .map((r) => [r.erp_so_item_name as string, Number(r.line)] as const)
        .filter(([, n]) => Number.isFinite(n) && n > 0)
    )
  } catch (e) {
    console.error('dashboard line lookup failed:', e)
    return {}
  }
}

/** Flip the order's dashboard rows immediately. `mode` mirrors what the sync
 *  will compute on its next run. if_number is "SO-00075" or "SO-00075 (IF…)".
 *  `soItems` (Sales Order Item child names) scopes the flip to just those
 *  LINES via erp_order_line_map — shipping one line of a multi-line order must
 *  not mark its sibling lines shipped (found via SO-00037, 2026-07-03). No
 *  soItems -> all the order's rows (whole-order actions). */
export async function flipDashboardStatus(
  so: string,
  mode: 'shipped' | 'staged',
  soItems?: string[]
): Promise<void> {
  try {
    const today = new Date()
    const patch: Record<string, unknown> = { work_order_status: mode }
    if (mode === 'shipped') {
      patch.shipped_date = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`
    } else {
      // undo: a lingering ship date kept the order grouped under Shipped in
      // Orders Data / Shipping Overview (Simon 2026-07-03)
      patch.shipped_date = null
    }
    let q = supabaseAdmin.from('dashboard_orders').update(patch)
    if (soItems && soItems.length > 0) {
      const { data: mapRows } = await supabaseAdmin
        .from('erp_order_line_map')
        .select('line')
        .in('erp_so_item_name', soItems)
      const lines = (mapRows ?? []).map((r) => r.line)
      if (lines.length === 0) return // unmapped lines -> let the sync handle it
      q = q.in('line', lines)
    } else {
      // so is validated upstream (^[A-Za-z0-9-]+$), safe to embed in the filter
      q = q.or(`if_number.eq.${so},if_number.like.${so} (%`)
    }
    await q
  } catch (e) {
    console.error('dashboard status flip failed:', e)
  }
}
