import { supabaseAdmin } from '@/lib/supabase-admin'

export interface Actor {
  email: string | null
  name: string | null
}

/** Resolve the acting user (for audit attribution) from the x-user-id header. */
export async function resolveActor(userId: string | null | undefined): Promise<Actor> {
  if (!userId) return { email: null, name: null }
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single()
  return { email: data?.email ?? null, name: data?.full_name ?? null }
}

export interface AuditEntry {
  order_id: string
  item_description: string | null
  action: 'created' | 'updated' | 'deleted' | 'restored'
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null
}

/** Insert one or more audit rows attributed to the actor. */
export async function logPurchasing(actor: Actor, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return
  const rows = entries.map((e) => ({
    order_id: e.order_id,
    item_description: e.item_description ?? null,
    action: e.action,
    field_name: e.field_name ?? null,
    old_value: e.old_value ?? null,
    new_value: e.new_value ?? null,
    performed_by_email: actor.email,
    performed_by_name: actor.name,
  }))
  const { error } = await supabaseAdmin.from('purchasing_audit').insert(rows)
  if (error) console.error('purchasing_audit insert failed:', error.message)
}

/** Normalize a field value to a comparable/displayable string for diffs. */
export function auditStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}
