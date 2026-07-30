import type { DeliverableKind, DeliverablePartner } from './types'

// Single choke-point for filename → kind/partner classification. The
// deliverables listing (what the UI offers) and the print route (what the
// server accepts) MUST agree — when they were separate prefix lists, the UI
// offered Amazon/repair files the print POST then rejected with 422.

/** Repair slips carry no carrier token beyond the ones checked here, so we
 *  read the carrier out of the filename when we can and otherwise fall back to
 *  the generic letter-size packing kind (packing-fedex — today's repair path
 *  only re-emits Home Depot FedEx orders) rather than inventing a new kind. */
function repairPackingKind(lower: string): DeliverableKind {
  if (lower.includes('amazon') || lower.includes('ups')) return 'packing-ups'
  if (lower.includes('ltl')) return 'packing-ltl'
  return 'packing-fedex'
}

export function fileKind(name: string): DeliverableKind {
  const lower = name.toLowerCase()
  if (lower.startsWith('packing-slips-fedex-')) return 'packing-fedex'
  if (lower.startsWith('packing-slips-ltl-')) return 'packing-ltl'
  if (lower.startsWith('labels-print-')) return 'labels'
  if (lower.startsWith('run-summary-')) return 'summary'
  if (lower.startsWith('packing-slips-amazon-')) return 'packing-ups'
  // The repair path emitted the singular packing-slip- form; accept both.
  if (lower.startsWith('packing-slip-repair-') || lower.startsWith('packing-slips-repair-')) {
    return repairPackingKind(lower)
  }
  if (lower.startsWith('labels-repair-')) return 'labels'
  return 'other'
}

export function filePartner(name: string): DeliverablePartner {
  const lower = name.toLowerCase()
  if (lower.includes('-amazon-')) return 'amazon'
  if (
    lower.startsWith('packing-slips-fedex-') ||
    lower.startsWith('packing-slips-ltl-') ||
    lower.startsWith('labels-print-') ||
    lower.startsWith('run-summary-') ||
    // Repair files without an -amazon- token come from the Home Depot
    // (sps-order-intro) repair path.
    lower.startsWith('packing-slip-repair-') ||
    lower.startsWith('packing-slips-repair-') ||
    lower.startsWith('labels-repair-')
  ) {
    return 'home-depot'
  }
  return 'unknown'
}

/** Letter-size kinds print via a station's letter printer; labels go to the
 *  Zebra queue; 'other' is not printable at all. The print page's own
 *  LETTER_KINDS set must stay in sync with this. */
export const SERVER_LETTER_KINDS: ReadonlySet<DeliverableKind> = new Set([
  'packing-fedex',
  'packing-ltl',
  'packing-ups',
  'summary',
])

export const SERVER_ZEBRA_KINDS: ReadonlySet<DeliverableKind> = new Set(['labels'])
