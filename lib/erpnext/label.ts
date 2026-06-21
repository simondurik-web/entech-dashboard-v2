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

export interface PalletLabel {
  itemCode: string // internal P/N — the prominent field
  itemName: string
  qty: number
  uom?: string
  batch: string // QR payload + printed pallet id
  customer?: string
  salesOrder?: string // printed when the pallet is attached to a sales order
  weight?: string // optional, captured at print time
  dimensions?: string // optional, captured at print time
  ref?: string // optional PO/IF reference
}

// Sanitize a value for a ZPL ^FD field: strip ZPL control prefixes (^ ~), the
// field-escape char (\), and CR/LF/control chars, collapse whitespace, cap length.
// Hyphens/dots are preserved (part numbers like EB-BRN / 620.308.2211 need them).
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

// Render `text` as a QR into a ^GFA field of roughly `targetPx` square. A quiet
// zone of `quiet` modules is baked in (scanners need it). Bit = 1 prints black in
// ZPL ^GF, and the qrcode matrix marks dark modules as 1, so no inversion needed.
function qrGfaField(text: string, targetPx: number, quiet = 4): { field: string; px: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const data = qr.modules.data
  const totalModules = n + quiet * 2
  const scale = Math.max(1, Math.floor(targetPx / totalModules))
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
  const itemCode = z(label.itemCode, 24)
  const itemName = z(label.itemName, 46)
  const customer = z(label.customer, 44)
  const salesOrder = z(label.salesOrder, 34)
  const weight = z(label.weight, 24)
  const dimensions = z(label.dimensions, 30)
  const batch = z(label.batch, 24)
  const uom = z(label.uom || 'pcs', 8)
  const qty = Number.isFinite(label.qty) ? Math.max(0, Math.round(label.qty)) : 0

  // QR ~2.5in (508 dots @ 203dpi). Bitmap is axis-aligned; a QR scans at any
  // rotation, so it needs no rotation to match the rotated text.
  const qr = qrGfaField(batch, 508)

  // Rotated text line: x = distance from the reading top (we step DOWN by reducing x),
  // y = distance from the reading left. h = font height.
  const T = (x: number, y: number, h: number, text: string) =>
    `^FO${x},${y}^A0R,${h},${h}^FD${text}^FS`

  const Y = 36 // left margin (reading)
  const lines: string[] = ['^XA', '^PW812', '^LL1218', '^CI28', '^LH0,0']

  // Header block (reading top -> down): part number, qty, then the pallet id
  // directly under the qty (Simon 2026-06-21).
  lines.push(T(786, Y, 26, 'PART No.'))
  lines.push(T(682, Y, 100, itemCode))
  lines.push(T(636, Y, 34, itemName))
  lines.push(T(528, Y, 96, `QTY: ${qty} ${uom}`))
  lines.push(T(486, Y, 26, 'PALLET'))
  lines.push(T(398, Y, 84, batch))

  // Optional rows (only what's provided), stepping further down (lower x).
  let x = 344
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
  if (customer) {
    lines.push(T(x, Y, 32, `Customer: ${customer}`))
    x -= 44
  }

  // Scan zone (reading right side): big QR + "SCAN PALLET" caption.
  const qrX = 150 // vertical placement (reading); qrX + 508 <= 812
  const qrY = 660 // horizontal placement (reading right); qrY + 508 <= 1218
  lines.push(`^FO${qrX},${qrY}${qr.field}^FS`)
  lines.push(T(qrX - 44, qrY + 150, 30, 'SCAN PALLET'))

  lines.push('^XZ')
  return lines.join('\n')
}
