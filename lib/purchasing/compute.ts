// Replicates the "all data Combined" sheet formulas so computed columns stay
// live when items are added/edited in the dashboard.
import type { PurchasingOrder, PurchasingRow, OrderStatus } from './types'

const has = (v: string | null | undefined) => !!v && String(v).trim() !== ''

/** Coerce a DB value to a number. supabase-js returns `numeric` columns as
 *  strings, so quantity/cost arrive as e.g. "250.00" — always normalize. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? null : n
}

/**
 * Order Status — mirrors sheet column C:
 *   Refunded > Canceled > Partial, else IFS(Requested / Ordered / Received).
 */
export function deriveStatus(o: PurchasingOrder): OrderStatus {
  if (!has(o.item_description)) return ''
  // Manual status set from the dropdown wins; otherwise it's purely date-derived.
  // (Legacy canceled/refunded/partial booleans were migrated into status_override,
  // so they are intentionally NOT consulted here — that lets "Auto" mean by-date
  // and lets "Mark received" actually show Received.)
  const override = (o.status_override ?? '').trim()
  if (override) return override as OrderStatus
  if (has(o.date_requested) && !has(o.date_ordered) && !has(o.received_date)) return 'Requested'
  if (has(o.date_ordered) && !has(o.received_date)) return 'Ordered'
  if (has(o.received_date)) return 'Received'
  return ''
}

/** Cost per unit — mirrors sheet column F: =IF(OR(D="",E=""),"",E/D). */
export function costPerUnit(o: PurchasingOrder): number | null {
  const total = toNum(o.total_cost)
  const qty = toNum(o.quantity)
  if (total == null || qty == null || qty === 0) return null
  return total / qty
}

const MS_PER_DAY = 86400000
function todayUTC(): number {
  const n = new Date()
  return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
}

/**
 * Days until delivery — mirrors sheet column U: only meaningful when Ordered.
 * Returns whole days (negative if past due), or null when not applicable /
 * missing a promised date.
 */
export function daysUntilDelivery(o: PurchasingOrder, status?: OrderStatus): number | null {
  const s = status ?? deriveStatus(o)
  if (s !== 'Ordered' || !has(o.promised_date)) return null
  const promised = Date.parse(o.promised_date as string)
  if (Number.isNaN(promised)) return null
  return Math.round((promised - todayUTC()) / MS_PER_DAY)
}

/** Build a display row (raw + computed). */
export function toRow(o: PurchasingOrder): PurchasingRow {
  const order_status = deriveStatus(o)
  return {
    ...o,
    order_status,
    cost_per_unit: costPerUnit(o),
    days_until_delivery: daysUntilDelivery(o, order_status),
  }
}

/**
 * Department auto-derive — mirrors sheet column O regex on Sub Department.
 * Used only to pre-fill the Department field when adding a new item; historical
 * rows keep their literal department value.
 */
export function deriveDepartment(subDepartment: string | null | undefined): string {
  const n = (subDepartment ?? '').toLowerCase()
  if (!n.trim()) return ''
  if (/molding/.test(n)) return 'Molding'
  if (/rubber/.test(n)) return 'Rubber'
  if (/melt line/.test(n)) return 'Melt line'
  if (/asphalt/.test(n)) return 'Asphalt'
  return ''
}

/** A department value counts as the "Rubber" department (hidden by default). */
export function isRubberDepartment(department: string | null | undefined): boolean {
  return (department ?? '').trim().toLowerCase() === 'rubber'
}
