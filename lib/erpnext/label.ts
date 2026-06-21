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

export function buildPalletZpl(label: PalletLabel): string {
  const itemCode = z(label.itemCode, 24)
  const itemName = z(label.itemName, 44)
  const customer = z(label.customer, 40)
  const salesOrder = z(label.salesOrder, 30)
  const weight = z(label.weight, 24)
  const dimensions = z(label.dimensions, 30)
  const batch = z(label.batch, 24)
  const uom = z(label.uom || 'pcs', 8)
  const qty = Number.isFinite(label.qty) ? Math.max(0, Math.round(label.qty)) : 0

  // Big QR (scannable from a distance); the payload is the bare pallet code.
  const qr = qrGfaField(batch, 348)
  const qrX = 60
  const qrY = 630

  const lines: string[] = [
    '^XA',
    '^PW812',
    '^LL1218',
    '^CI28',
    '^LH0,0',
    // Internal part number (prominent) — no company name/logo.
    '^FO40,46^A0N,30,30^FDPART No.^FS',
    `^FO40,84^A0N,100,100^FD${itemCode}^FS`,
    // Description
    `^FO40,200^A0N,36,36^FD${itemName}^FS`,
    // Quantity (prominent)
    `^FO40,250^A0N,90,90^FDQTY: ${qty} ${uom}^FS`,
  ]

  // Optional middle block (only what's provided), stacked.
  let y = 362
  if (weight) {
    lines.push(`^FO40,${y}^A0N,34,34^FDWeight: ${weight}^FS`)
    y += 44
  }
  if (dimensions) {
    lines.push(`^FO40,${y}^A0N,34,34^FDDimensions: ${dimensions}^FS`)
    y += 44
  }
  if (salesOrder) {
    lines.push(`^FO40,${y}^A0N,34,34^FDSales Order: ${salesOrder}^FS`)
    y += 44
  }
  if (customer) {
    lines.push(`^FO40,${y}^A0N,34,34^FDCustomer: ${customer}^FS`)
    y += 44
  }

  lines.push(
    // Divider above the scan zone
    '^FO40,600^GB732,3,3^FS',
    // Big QR (multi-purpose: ship / transfer / lookup)
    `^FO${qrX},${qrY}${qr.field}^FS`,
    `^FO${qrX + 40},${qrY + qr.px + 16}^A0N,34,34^FDSCAN PALLET^FS`,
    // Pallet id (human-readable), beside the QR
    `^FO${qrX + qr.px + 40},${qrY + 30}^A0N,34,34^FDPALLET^FS`,
    `^FO${qrX + qr.px + 40},${qrY + 74}^A0N,84,84^FD${batch}^FS`,
    '^XZ'
  )

  return lines.join('\n')
}
