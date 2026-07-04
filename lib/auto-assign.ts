import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAutoAssignee } from '@/lib/auto-assign-rules'
import type { Order } from '@/lib/supabase-data'

/**
 * Auto-assign unassigned orders based on customer rules (e.g. Origen RV
 * Accessories / Technoflex -> Joseles).
 *
 * Persists to Supabase `dashboard_orders`, the live source of truth after the
 * 2026-06-30 ERPNext cutover. The ERPNext->dashboard sync
 * (sync_erpnext_to_dashboard.py) preserves assigned_to and only inserts NEW
 * lines as unassigned, so once we set it here it sticks across sync cycles.
 *
 * IMPORTANT: this mutates each matched order's `assignedTo` in place so the
 * SAME /api/sheets response reflects the assignment. Previously it only wrote
 * to the DB fire-and-forget, so the assignment never showed on the current
 * load (needed a second refresh) and — worse — the write ran AFTER the
 * serverless response returned, where Vercel can freeze the function before it
 * completes. That made auto-assign flaky post-migration (Simon, 2026-07-04).
 *
 * The old Google Sheets write was removed 2026-07-04: the sheet->db sync
 * (sync_sheets_to_db.py) has been disabled since the ERPNext cutover, so the
 * sheet is no longer read by anything and writing to it was dead weight (an
 * extra serialized Google Sheets API call + failure surface on every fetch).
 *
 * Callers should `await` this before returning so the writes reliably land.
 */
export async function applyAutoAssignRules(orders: Order[]): Promise<void> {
  // Group the lines that need assigning by assignee so we do one UPDATE each.
  const linesByAssignee = new Map<string, string[]>()

  for (const order of orders) {
    // Only auto-assign if currently unassigned
    if (order.assignedTo && order.assignedTo.trim() !== '') continue

    const assignee = getAutoAssignee(order.customer)
    if (!assignee) continue

    // Reflect immediately in the response we're about to return.
    order.assignedTo = assignee

    const lines = linesByAssignee.get(assignee) ?? []
    lines.push(order.line)
    linesByAssignee.set(assignee, lines)
  }

  if (linesByAssignee.size === 0) return

  const total = [...linesByAssignee.values()].reduce((n, l) => n + l.length, 0)
  console.log(`[auto-assign] Assigning ${total} orders based on customer rules`)

  // Persist to Supabase (live source of truth) — one batched update per assignee.
  for (const [assignee, lines] of linesByAssignee) {
    const { error } = await supabaseAdmin
      .from('dashboard_orders')
      .update({ assigned_to: assignee })
      .in('line', lines)
    if (error) {
      console.warn(`[auto-assign] Supabase update failed for ${assignee} (${lines.length} lines):`, error.message)
    }
  }
}
