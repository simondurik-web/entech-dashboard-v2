import { supabaseAdmin } from '@/lib/supabase-admin'

// Truckloads — multiple SOs locked to one physical truck (Simon 2026-07-08).
// Data lives in Supabase (truckloads + truckload_orders); ERPNext stays
// untouched: shipping still produces one Delivery Note per order, the
// truckload just chains them and stamps custom_truckload_no on each DN.

export interface TruckloadOrderRow {
  id: string
  so_number: string
  order_key: string
  if_number: string | null
  customer: string | null
  part_number: string | null
  position: number
  status: 'pending' | 'shipped' | 'released'
  dn_number: string | null
  released_by: string | null
  released_at: string | null
}

export interface TruckloadRow {
  id: string
  load_number: string
  status: 'planned' | 'loading' | 'shipped' | 'canceled'
  notes: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  shipped_at: string | null
  truckload_orders: TruckloadOrderRow[]
}

export const ACTIVE_TL_STATUSES = ['planned', 'loading'] as const

const LIST_COLUMNS =
  'id, load_number, status, notes, created_by_name, created_at, updated_at, shipped_at,' +
  ' truckload_orders(id, so_number, order_key, if_number, customer, part_number, position, status, dn_number, released_by, released_at)'

export async function listTruckloads(scope: 'active' | 'all'): Promise<TruckloadRow[]> {
  let q = supabaseAdmin
    .from('truckloads')
    .select(LIST_COLUMNS)
    .order('created_at', { ascending: false })
  if (scope === 'active') q = q.in('status', [...ACTIVE_TL_STATUSES])
  else q = q.limit(60)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as TruckloadRow[]
  for (const r of rows) r.truckload_orders.sort((a, b) => a.position - b.position)
  return rows
}

export async function getTruckload(id: string): Promise<(TruckloadRow & { calculator_state: unknown }) | null> {
  const { data, error } = await supabaseAdmin
    .from('truckloads')
    .select(`${LIST_COLUMNS}, calculator_state`)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as unknown as TruckloadRow & { calculator_state: unknown }
  row.truckload_orders.sort((a, b) => a.position - b.position)
  return row
}

/** Active truckload containing this SO with the order still pending — the ship
 *  flow's gate. Returns the truckload plus the matching order rows. */
export async function activeTruckloadForSo(so: string): Promise<TruckloadRow | null> {
  const { data, error } = await supabaseAdmin
    .from('truckload_orders')
    .select('truckload_id, status, truckloads!inner(status)')
    .eq('so_number', so)
    .eq('status', 'pending')
    .in('truckloads.status', [...ACTIVE_TL_STATUSES])
  if (error) throw new Error(error.message)
  const tlId = data?.[0]?.truckload_id as string | undefined
  if (!tlId) return null
  const { data: tl, error: tlErr } = await supabaseAdmin
    .from('truckloads')
    .select(LIST_COLUMNS)
    .eq('id', tlId)
    .single()
  if (tlErr) throw new Error(tlErr.message)
  const row = tl as unknown as TruckloadRow
  row.truckload_orders.sort((a, b) => a.position - b.position)
  return row
}

/** Order keys already locked into some OTHER active truckload (create/edit guard). */
export async function conflictingOrderKeys(orderKeys: string[], excludeTruckloadId?: string): Promise<Map<string, string>> {
  if (!orderKeys.length) return new Map()
  let q = supabaseAdmin
    .from('truckload_orders')
    .select('order_key, truckload_id, truckloads!inner(status, load_number)')
    .in('order_key', orderKeys)
    .eq('status', 'pending')
    .in('truckloads.status', [...ACTIVE_TL_STATUSES])
  if (excludeTruckloadId) q = q.neq('truckload_id', excludeTruckloadId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const out = new Map<string, string>()
  for (const r of (data ?? []) as unknown as { order_key: string; truckloads: { load_number: string } }[]) {
    out.set(r.order_key, r.truckloads.load_number)
  }
  return out
}

/** After a member order ships (or is released): keep the parent status honest.
 *  loading while any pending remain; shipped once none do. */
export async function rollupTruckloadStatus(truckloadId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('truckload_orders')
    .select('status')
    .eq('truckload_id', truckloadId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { status: string }[]
  const pending = rows.filter((r) => r.status === 'pending').length
  const shippedAny = rows.some((r) => r.status === 'shipped')
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (pending === 0 && shippedAny) {
    patch.status = 'shipped'
    patch.shipped_at = new Date().toISOString()
  } else if (shippedAny) {
    patch.status = 'loading'
  }
  await supabaseAdmin.from('truckloads').update(patch).eq('id', truckloadId).in('status', [...ACTIVE_TL_STATUSES])
}
