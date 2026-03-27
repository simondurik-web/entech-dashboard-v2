/**
 * Auto-assign rules: map customer names to default assignees.
 * When a new order appears (or is unassigned), if the customer matches,
 * automatically assign to the specified person.
 */

export interface AutoAssignRule {
  /** Customer name — matched case-insensitively, supports partial match */
  customer: string
  /** Assignee name to auto-fill */
  assignee: string
}

export const AUTO_ASSIGN_RULES: AutoAssignRule[] = [
  { customer: 'Technoflex Intl Inc', assignee: 'Joseles' },
  { customer: 'Origen RV Accessories', assignee: 'Joseles' },
]

/**
 * Check if a customer matches any auto-assign rule.
 * Returns the assignee name or null if no match.
 */
export function getAutoAssignee(customer: string | null | undefined): string | null {
  if (!customer) return null
  const normalized = customer.trim().toLowerCase()
  for (const rule of AUTO_ASSIGN_RULES) {
    if (normalized.includes(rule.customer.toLowerCase())) {
      return rule.assignee
    }
  }
  return null
}
