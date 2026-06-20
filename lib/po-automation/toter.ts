// Toter / Wastequip portal-entry shared helpers (dashboard side).
//
// Toter freight orders come into the dashboard under a few customer spellings —
// the buying entity is Wastequip but the Fusion/dashboard account is "Toter LLC"
// and the PO bill-to is "Wastequip, LLC". See memory reference_wastequip_toter_po_kb
// ("Wastequip -> Toter. Always."). Match on either token, case-insensitive.

export const TOTER_PORTAL_URL = 'https://wastequip.pcssoft.com/'

/** Active (in-flight) request statuses — button shows "requested", not actionable. */
export const TOTER_ACTIVE_STATUSES = ['queued', 'notified', 'running'] as const

export type ToterEntryStatus =
  | 'queued'
  | 'notified'
  | 'running'
  | 'entered'
  | 'failed'
  | 'canceled'

export function isToterCustomer(customer: string | null | undefined): boolean {
  const c = (customer ?? '').trim().toLowerCase()
  if (!c) return false
  return c.includes('toter') || c.includes('wastequip')
}
