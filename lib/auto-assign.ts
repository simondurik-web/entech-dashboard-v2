import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateAssignedTo } from '@/lib/google-sheets-write'
import { getAutoAssignee } from '@/lib/auto-assign-rules'
import type { Order } from '@/lib/supabase-data'

/**
 * Check all orders and auto-assign unassigned ones based on customer rules.
 * Updates both Supabase (immediate) and Google Sheets (source of truth).
 * Runs as fire-and-forget on each /api/sheets fetch.
 */
export async function applyAutoAssignRules(orders: Order[]): Promise<void> {
  const toAssign: { line: string; assignee: string }[] = []

  for (const order of orders) {
    // Only auto-assign if currently unassigned
    if (order.assignedTo && order.assignedTo.trim() !== '') continue

    const assignee = getAutoAssignee(order.customer)
    if (assignee) {
      toAssign.push({ line: order.line, assignee })
    }
  }

  if (toAssign.length === 0) return

  console.log(`[auto-assign] Assigning ${toAssign.length} orders based on customer rules`)

  // Batch update Supabase
  for (const { line, assignee } of toAssign) {
    await supabaseAdmin
      .from('dashboard_orders')
      .update({ assigned_to: assignee })
      .eq('line', line)
      .then(({ error }) => {
        if (error) console.warn(`[auto-assign] Supabase update failed for line ${line}:`, error.message)
      })
  }

  // Update Google Sheets (source of truth) — serialize to avoid rate limits
  for (const { line, assignee } of toAssign) {
    try {
      await updateAssignedTo(line, assignee)
    } catch (err) {
      console.warn(`[auto-assign] Sheets update failed for line ${line}:`, err)
    }
  }
}
