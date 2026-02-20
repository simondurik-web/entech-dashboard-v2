import type { Order } from './google-sheets'

/**
 * Compute priority server-side based on production capacity and due dates.
 *
 * Formula:
 *   daysToProduce = ceil(orderQty / dailyCapacity)
 *   buffer = daysToProduce + 3
 *   startDate = requestedCompletionDate - buffer days
 *   daysUntilStart = startDate - today
 *
 *   ≤5  → P1
 *   ≤10 → P2
 *   ≤20 → P3
 *   >20 → P4
 *
 * If urgent_override = true → URGENT (overrides everything)
 * If priority_override is set → use that (manual override from dashboard)
 * If missing data (no date, no capacity, no qty) → null
 */

const ACTIVE_STATUSES = new Set(['pending', 'wip', 'approved', 'staged', 'need to make', 'work in progress', 'making', 'released', 'in production', 'completed', 'ready to ship'])

function normalizeForPriority(internalStatus: string, ifStatus: string): string {
  const s = (internalStatus || ifStatus || '').toLowerCase().trim()
  if (s === 'shipped' || s === 'invoiced' || s === 'to bill') return 'shipped'
  if (s === 'cancelled') return 'cancelled'
  if (s === 'staged' || s === 'ready to ship') return 'staged'
  if (s === 'wip' || s === 'work in progress' || s === 'making' || s === 'released' || s === 'in production') return 'wip'
  if (s === 'completed') return 'completed'
  if (s === 'pending' || s === 'need to make' || s === 'approved') return 'pending'
  return s
}

export type PriorityValue = 'P1' | 'P2' | 'P3' | 'P4' | 'URGENT' | null

export function computePriority(order: Order): PriorityValue {
  // Only compute for active statuses
  const status = normalizeForPriority(order.internalStatus, order.ifStatus)
  if (!ACTIVE_STATUSES.has(status) && status !== 'pending' && status !== 'wip' && status !== 'staged' && status !== 'completed') {
    return null
  }

  // Urgent override wins
  if (order.urgentOverride) return 'URGENT'

  // Need: orderQty, dailyCapacity, requestedDate
  if (!order.orderQty || !order.dailyCapacity || !order.requestedDate) return null

  const daysToProduce = Math.ceil(order.orderQty / order.dailyCapacity)
  const buffer = daysToProduce + 3

  // Parse requested completion date
  const reqDate = new Date(order.requestedDate)
  if (isNaN(reqDate.getTime())) return null

  // startDate = requestedDate - buffer days
  const startDate = new Date(reqDate)
  startDate.setDate(startDate.getDate() - buffer)

  // daysUntilStart = startDate - today
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  startDate.setHours(0, 0, 0, 0)

  const daysUntilStart = Math.floor((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (daysUntilStart <= 5) return 'P1'
  if (daysUntilStart <= 10) return 'P2'
  if (daysUntilStart <= 20) return 'P3'
  return 'P4'
}

/**
 * Get the effective priority for an order.
 * Priority override (manual) takes precedence over computed.
 */
export function getEffectivePriority(order: Order): PriorityValue {
  if (order.priorityOverride) return order.priorityOverride as PriorityValue
  return computePriority(order)
}
