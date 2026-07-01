import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Order display enrichment for pallet/shipping records.
 *
 * Post-Fusion→ERPNext cutover (2026-06-30), dashboard_orders.if_number holds the
 * new Sales Order number, e.g. "SAL-ORD-2026-00072 (IF152289)". Pallet & shipping
 * records were historically keyed by the raw IF# and read off a stale Google Sheet.
 *
 * These helpers let the record views display the CURRENT Sales Order number in place
 * of the raw IF#, without rewriting history: a record is upgraded only when it maps to
 * a live order (by line number, or by the IF token embedded in the SO composite).
 * Records with no live match keep their original historical IF# — exactly the
 * "keep old history, start SO numbers as of cutover" behaviour Simon asked for.
 */

export interface OrderDisplayInfo {
  ifNumber: string // SAL-ORD composite from dashboard_orders.if_number
  customer: string
  category: string
  line: string
}

export interface OrderDisplayLookup {
  byLine: Map<string, OrderDisplayInfo>
  byRawIf: Map<string, OrderDisplayInfo>
}

function normIf(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase()
}

/** Load live orders once and build line-number + raw-IF lookup maps. */
export async function buildOrderDisplayLookup(): Promise<OrderDisplayLookup> {
  const byLine = new Map<string, OrderDisplayInfo>()
  const byRawIf = new Map<string, OrderDisplayInfo>()
  const { data } = await supabaseAdmin
    .from('dashboard_orders')
    .select('line,if_number,customer,category')
  for (const o of data ?? []) {
    if (o.line === null || o.line === undefined) continue
    const info: OrderDisplayInfo = {
      ifNumber: o.if_number || '',
      customer: o.customer || '',
      category: o.category || '',
      line: String(o.line),
    }
    byLine.set(String(o.line), info)
    // "SAL-ORD-2026-00072 (IF152289)" → key IF152289; also bare legacy "IF152289"
    const token = (o.if_number || '').match(/IF\s*\d+/i)
    if (token) byRawIf.set(normIf(token[0]), info)
  }
  return { byLine, byRawIf }
}

/**
 * Resolve the live-order display info for a record, or null if it maps to no live
 * order (i.e. it is purely historical and should keep its original IF#).
 */
export function resolveDisplayOrder(
  lookup: OrderDisplayLookup,
  lineNumber: string | number | null | undefined,
  currentIf: string | null | undefined,
): OrderDisplayInfo | null {
  if (lineNumber !== null && lineNumber !== undefined && String(lineNumber).trim()) {
    const hit = lookup.byLine.get(String(lineNumber).trim())
    if (hit) return hit
  }
  if (currentIf && currentIf.trim()) {
    const token = currentIf.match(/IF\s*\d+/i)
    if (token) {
      const hit = lookup.byRawIf.get(normIf(token[0]))
      if (hit) return hit
    }
  }
  return null
}
