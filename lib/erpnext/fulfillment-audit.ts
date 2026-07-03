import { supabaseAdmin } from '@/lib/supabase-admin'

// Load log + instant status flip for the fulfillment wrapper (Simon 2026-07-03):
// every ship/undo/sign/upload is recorded for traceability, and the dashboard
// row hops between Ready to Ship / Shipped immediately instead of waiting for
// the 5-minute ERPNext sync. Both are best-effort side effects — a logging or
// flip failure must never fail the shipment action itself (the sync remains
// the source of truth and self-heals the row within minutes).

export type FulfillmentAction = 'complete' | 'undo' | 'sign_bol' | 'upload_customer_bol'

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

/** Flip the order's dashboard rows immediately. `mode` mirrors what the sync
 *  will compute on its next run. if_number is "SO-00075" or "SO-00075 (IF…)". */
export async function flipDashboardStatus(so: string, mode: 'shipped' | 'staged'): Promise<void> {
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
    // so is validated upstream (^[A-Za-z0-9-]+$), safe to embed in the filter
    await supabaseAdmin
      .from('dashboard_orders')
      .update(patch)
      .or(`if_number.eq.${so},if_number.like.${so} (%`)
  } catch (e) {
    console.error('dashboard status flip failed:', e)
  }
}
