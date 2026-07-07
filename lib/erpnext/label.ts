// Pallet label -> ZT411 ZPL (4x6 @ 203dpi, portrait 812 x 1218).
//
// Native ZPL text + a QR rendered as a scalable ^GFA bitmap (via the `qrcode`
// lib), so it renders in a Vercel serverless route with no font/image pipeline
// yet the QR can be far larger than native ^BQ allows (~1in cap).
//
// RULES:
//  - NO company name or logo (Simon 2026-06-21): the company is being renamed, so
//    a name-free label never needs relabeling. See feedback_labels_no_company_name.
//  - The prominent number is OUR internal part number (ERPNext item_code), never the
//    customer P/N. See feedback_labels_use_internal_part_numbers.
//  - The bin/location is deliberately NOT printed — pallets move, and a stale
//    location on a label is worse than none.
//  - Sales Order / Weight / Dimensions print only when provided (room reserved).

import QRCode from 'qrcode'
import { SNAPPAD_LOGO_GFA, SNAPPAD_LOGO_MEDIA_W, SNAPPAD_LOGO_MEDIA_H } from './snappad-logo'

// The operation runs server-side on Vercel (UTC), so a bare new Date().toLocaleString()
// stamps the label in UTC. The shop is on US Eastern (Middlebury, IN), so force the zone.
export const LABEL_TIME_ZONE = 'America/Detroit'
export function labelTimestamp(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: LABEL_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export interface PalletLabel {
  itemCode: string // internal P/N — the prominent field
  itemName: string
  qty: number
  uom?: string
  batch: string // QR payload + printed pallet id
  customer?: string
  customerPartNo?: string // the customer's own part number (from customer_part_mappings); printed when an SO is attached
  salesOrder?: string // printed when the pallet is attached to a sales order
  weight?: string // optional, captured at print time
  dimensions?: string // optional, captured at print time
  generatedAt?: string // date+time the label was generated (printed in the scan zone)
  printedBy?: string // name of the person who printed it (printed under the timestamp)
  ref?: string // optional PO/IF reference
  qrPayload?: string // QR contents; defaults to `batch`. Non-serialized labels encode the part number.
  copies?: number // print this many identical copies (^PQ) — non-serialized: one per box.
  // Product-brand logo (Simon 2026-07-03: DEFAULT for all Snap Pad item-group
  // products, current and future). This is the PRODUCT's brand, not company
  // branding — the no-company-logo rule (2026-06-21) still applies to
  // everything else. Only affects layout when set; other labels are unchanged.
  brand?: 'snappad'
}

// Sanitize a value for a ZPL ^FD field: strip ZPL control prefixes (^ ~), the
// field-escape char (\), and CR/LF/control chars, collapse whitespace, cap length.
// Hyphens/dots are preserved (part numbers like EB-BRN / 620.308.2211 need them).
/** Product-brand for an ERPNext item group. Snap Pad products (current AND
 *  future — any item in the group) get the SnapPad logo by default
 *  (Simon 2026-07-03). */
export function brandForItemGroup(itemGroup?: string | null): PalletLabel['brand'] {
  return itemGroup === 'Snap Pad' ? 'snappad' : undefined
}

function z(value: string | undefined, max = 42): string {
  const stripped = (value ?? '')
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0)
      if (c < 0x20) return ' '
      if (ch === '^' || ch === '~' || ch === '\\') return ' '
      return ch
    })
    .join('')
  return stripped.replace(/\s+/g, ' ').trim().slice(0, max)
}

// Render `text` as a QR into a ^GFA field whose VISIBLE pattern is ~targetPx square.
// `targetPx` sizes the data pattern itself (not counting the quiet zone), so the
// printed code measures what we ask for. A short pallet code is only a 21x21
// (version 1) symbol, so we use the highest error correction (H) for maximum scan
// robustness — it doesn't change the size but makes a big, low-density code very
// easy to read. Bit = 1 prints black in ZPL ^GF; the matrix marks dark modules as 1.
function qrGfaField(text: string, targetPx: number, quiet = 2): { field: string; px: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
  const n = qr.modules.size
  const data = qr.modules.data
  const totalModules = n + quiet * 2
  const scale = Math.max(1, Math.round(targetPx / n)) // size the pattern, not pattern+quiet
  const px = totalModules * scale
  const bytesPerRow = Math.ceil(px / 8)
  let hex = ''
  for (let y = 0; y < px; y++) {
    const my = Math.floor(y / scale) - quiet
    let cur = 0
    let bit = 0
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / scale) - quiet
      const dark = my >= 0 && my < n && mx >= 0 && mx < n && data[my * n + mx] ? 1 : 0
      cur = (cur << 1) | dark
      if (++bit === 8) {
        hex += cur.toString(16).padStart(2, '0').toUpperCase()
        cur = 0
        bit = 0
      }
    }
    if (bit > 0) {
      cur = cur << (8 - bit)
      hex += cur.toString(16).padStart(2, '0').toUpperCase()
    }
  }
  const total = bytesPerRow * px
  return { field: `^GFA,${total},${total},${bytesPerRow},${hex}`, px }
}

// LANDSCAPE label. The ZT411 head is 4in wide (812 dots) and feeds the 6in length
// (1218 dots), so a horizontal (landscape) label must have its content rotated 90deg
// — every text field uses ^A0R (rotated 90deg CW) and the QR bitmap sits in the scan
// zone. Read the label turned 90deg: media-Y is the reading width (left->right),
// higher media-X is nearer the reading top. Coordinates are grouped so a single
// test-print can dial them in. NO company name/logo (Simon 2026-06-21).
export function buildPalletZpl(label: PalletLabel): string {
  const itemCode = z(label.itemCode, 20)
  const itemName = z(label.itemName, 30)
  const customer = z(label.customer, 44)
  const customerPartNo = z(label.customerPartNo, 24)
  const salesOrder = z(label.salesOrder, 34)
  const weight = z(label.weight, 24)
  const dimensions = z(label.dimensions, 30)
  const batch = z(label.batch, 24)
  const generatedAt = z(label.generatedAt, 28)
  const printedBy = z(label.printedBy, 26)
  const uom = z(label.uom || 'pcs', 8)
  const qty = Number.isFinite(label.qty) ? Math.max(0, Math.round(label.qty)) : 0

  // QR ~2.5in (508 dots @ 203dpi). Bitmap is axis-aligned; a QR scans at any
  // rotation, so it needs no rotation to match the rotated text. A non-serialized
  // (generic) label has no pallet code, so its QR encodes the part number instead.
  const qr = qrGfaField(z(label.qrPayload, 60) || batch || itemCode, 508)

  // Rotated text line: x = distance from the reading top (we step DOWN by reducing x),
  // y = distance from the reading left. h = font height.
  const T = (x: number, y: number, h: number, text: string) =>
    `^FO${x},${y}^A0R,${h},${h}^FD${text}^FS`

  const Y = 36 // left margin (reading)
  // ^PR2: print at 2 in/s (ZT411 default is 6). Slower head speed = noticeably
  // crisper text/QR/logo edges on thermal media; Simon 2026-07-03 explicitly
  // traded speed for quality. Applies to every label this template prints.
  const lines: string[] = ['^XA', '^PR2', '^PW812', '^LL1218', '^CI28', '^LH0,0']

  // Header block (reading top -> down): part number, qty, then the pallet id
  // directly under the qty (Simon 2026-06-21). Fonts are sized so the longest
  // line stays left of the big QR (which begins at reading-x ~600).
  lines.push(T(788, Y, 26, 'PART No.'))
  lines.push(T(694, Y, 88, itemCode))
  lines.push(T(648, Y, 32, itemName))
  // QTY: pallets always have a qty; a generic label passes the pack size (pieces per box),
  // or 0 to omit the line entirely when the pack size is unknown.
  if (qty > 0) lines.push(T(548, Y, 84, `QTY: ${qty} ${uom}`))
  // PALLET id only on serialized labels; a generic (non-serialized) label has none.
  if (batch) {
    lines.push(T(506, Y, 26, 'PALLET'))
    lines.push(T(420, Y, 84, batch))
  }

  // Optional rows (only what's provided), stepping further down (lower x).
  let x = 360
  if (weight) {
    lines.push(T(x, Y, 32, `Weight: ${weight}`))
    x -= 44
  }
  if (dimensions) {
    lines.push(T(x, Y, 32, `Dimensions: ${dimensions}`))
    x -= 44
  }
  if (salesOrder) {
    lines.push(T(x, Y, 32, `Sales Order: ${salesOrder}`))
    x -= 44
  }
  // Customer's own part number (from the SO's customer mapping). Secondary to OUR
  // internal P/N — the prominent number stays the item_code (hard rule). Prints
  // only when an SO is selected at label time (Simon 2026-07-06). A touch larger
  // than the other rows so the receiving dock spots it.
  if (customerPartNo) {
    lines.push(T(x, Y, 38, `Cust P/N: ${customerPartNo}`))
    x -= 50
  }
  if (customer) {
    lines.push(T(x, Y, 32, `Customer: ${customer}`))
    x -= 44
  }

  // Scan zone (reading right side): big ~2.5in QR (SAME size with or without a
  // brand logo — scannability is untouchable). With a brand logo the QR shifts
  // toward the reading bottom to free ~0.9in above it for the logo, and the
  // timestamp/printed-by move to the bottom of the LEFT text column.
  const branded = label.brand === 'snappad'
  // Branded: reserve a REAL top margin (40 dots ≈ 0.2in) above the logo — the
  // first physical print (2026-07-03) clipped the logo top with only ~10 dots
  // of margin (printers eat the label edge). Logo sits 8 dots off the QR.
  const qrX = branded
    ? Math.max(10, 812 - qr.px - SNAPPAD_LOGO_MEDIA_W - 8 - 40)
    : Math.max(20, Math.min(150, 812 - qr.px - 20))
  const qrY = Math.min(610, 1218 - qr.px - 10)
  lines.push(`^FO${qrX},${qrY}${qr.field}^FS`)
  if (branded) {
    // Logo above the QR (reading), horizontally centered over it.
    const logoX = qrX + qr.px + 8
    const logoY = Math.max(0, qrY + Math.round((qr.px - SNAPPAD_LOGO_MEDIA_H) / 2))
    lines.push(`^FO${logoX},${logoY}${SNAPPAD_LOGO_GFA}^FS`)
    // Timestamp + printed-by continue the left column's step-down.
    if (generatedAt) {
      lines.push(T(x, Y, 26, generatedAt))
      x -= 38
    }
    if (printedBy) lines.push(T(x, Y, 24, `By: ${printedBy}`))
  } else {
    // Generated date/time + who printed it, in the scan zone (where "SCAN PALLET" was).
    if (generatedAt) lines.push(T(qrX - 44, qrY, 26, generatedAt))
    if (printedBy) lines.push(T(qrX - 78, qrY, 24, `By: ${printedBy}`))
  }

  // Print N identical copies (one label per box for non-serialized packs). ^PQ must
  // precede ^XZ. Clamp to a sane ceiling (covers any realistic single receive) so a bad
  // qty can't spool an unbounded run; 9999 is far above any real box count per receipt.
  const copies = Math.max(1, Math.min(9999, Math.round(label.copies ?? 1)))
  if (copies > 1) lines.push(`^PQ${copies},0,0,N`)

  lines.push('^XZ')
  return lines.join('\n')
}
