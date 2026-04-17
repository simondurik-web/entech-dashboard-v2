import { supabaseAdmin } from './supabase-admin'

/**
 * bom_cost_history rows are inserted by Postgres triggers during BOM item
 * UPDATEs, so the trigger's current_user is the service-role/Postgres role
 * — not the actual human. This helper fills in email/name on rows created
 * during the request's time window.
 *
 * Call with the timestamp captured right before the UPDATE(s). Safe to call
 * multiple times in the same request (e.g. once after the direct update and
 * again after the async cascade in after()).
 *
 * Single-user usage in practice, so the time-window scope is sufficient; if
 * concurrent edits become common, tighten the scope to known cascade item
 * ids.
 */
export async function attributeCostHistory(
  sinceIso: string,
  performedByEmail: string | null,
  performedByName: string | null
): Promise<void> {
  if (!performedByEmail && !performedByName) return
  try {
    await supabaseAdmin
      .from('bom_cost_history')
      .update({
        changed_by_email: performedByEmail,
        changed_by_name: performedByName,
      })
      .gte('changed_at', sinceIso)
      .is('changed_by_email', null)
  } catch (err) {
    console.error('[bom-cost-history-attribution] failed:', err)
  }
}
