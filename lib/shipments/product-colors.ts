// Chart colors match the PHYSICAL product color (Simon 2026-07-23, msg
// 1529906338430193804): Eco-Border and Curbs both come in red / brown / black
// / gray, so a bar's fill is the product's real color and the FAMILY is told
// apart by pattern — Eco-Border solid, Curbs hatched, anything else dotted.
// Part numbers encode both: family prefix (ECOBRD/EB/CURB/PAVER/TR...) + color
// token (RED/BRN|BR/BLK|BL/GRY|GREY).

/** SPS Commerce portal (Fulfillment/WebForms) — where Phil reviews the raw
 *  orders these shipments came from. */
export const SPS_PORTAL_URL = 'https://commerce.spscommerce.com'

export type ProductFamily = 'ecoborder' | 'curb' | 'other'

export interface PartVisual {
  /** The product's physical color (chart base fill). */
  color: string
  family: ProductFamily
  /** SVG pattern id for non-solid families; solid fills use the color alone. */
  patternId: string | null
  /** Outline keeps black product bars visible on the dark theme. */
  stroke: string
}

// Physical product colors, tuned to stay distinguishable on the dark theme.
const COLOR_HEX: Record<string, string> = {
  red: '#dc2626',
  brown: '#8a5a2b',
  black: '#3f3f46', // true black vanishes on the dark bg; charcoal + stroke reads as black
  gray: '#9ca3af',
}
const FALLBACK_COLOR = '#2563eb'

function colorOf(part: string): string {
  const p = part.toUpperCase()
  if (/(^|[^A-Z])RED([^A-Z]|$)/.test(p)) return COLOR_HEX.red
  if (/(^|[^A-Z])(BRN|BR|BROWN)([^A-Z]|$)/.test(p)) return COLOR_HEX.brown
  if (/(^|[^A-Z])(BLK|BL|BLACK)([^A-Z]|$)/.test(p)) return COLOR_HEX.black
  if (/(^|[^A-Z])(GRY|GREY|GRAY)([^A-Z]|$)/.test(p)) return COLOR_HEX.gray
  return FALLBACK_COLOR
}

function familyOf(part: string): ProductFamily {
  const p = part.toUpperCase()
  if (p.startsWith('CURB')) return 'curb'
  if (p.startsWith('ECOBRD') || p.startsWith('EB-') || p.startsWith('EB ')) return 'ecoborder'
  return 'other'
}

export function partVisual(part: string): PartVisual {
  const color = colorOf(part)
  const family = familyOf(part)
  const patternId =
    family === 'curb'
      ? `ship-hatch-${color.slice(1)}`
      : family === 'other'
        ? `ship-dots-${color.slice(1)}`
        : null
  return {
    color,
    family,
    patternId,
    stroke: color === COLOR_HEX.black ? '#a1a1aa' : 'rgba(255,255,255,0.25)',
  }
}

/** Recharts fill value: solid color for Eco-Border, pattern ref otherwise. */
export function partFill(part: string): string {
  const visual = partVisual(part)
  return visual.patternId ? `url(#${visual.patternId})` : visual.color
}

/** Unique pattern defs needed for a set of parts (render once inside the chart svg). */
export function patternDefsFor(parts: string[]): PartVisual[] {
  const seen = new Map<string, PartVisual>()
  for (const part of parts) {
    const visual = partVisual(part)
    if (visual.patternId && !seen.has(visual.patternId)) seen.set(visual.patternId, visual)
  }
  return [...seen.values()]
}
