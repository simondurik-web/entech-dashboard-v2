// Pallet label -> ZT411 ZPL (4x6 @ 203dpi, portrait 812 x 1218).
//
// Native ZPL (text + QR), so it renders in a Vercel serverless route with no
// image pipeline. Mirrors the ERP label fields (erp-4molding gen_pallet_labels_v2):
// the prominent number is OUR internal part number (ERPNext item_code), QR carries
// the batch id for scan/ship/transfer/lookup. The bin/location is deliberately
// NOT printed — pallets move, and a stale location on a label is worse than none.

export interface PalletLabel {
  itemCode: string // internal P/N — the prominent field
  itemName: string
  qty: number
  uom?: string
  batch: string // QR payload + printed reference
  customer?: string
  ref?: string // optional PO/SO/IF reference
}

// Sanitize a value for a ZPL ^FD field: strip the ZPL control prefixes (^ ~),
// the field-escape char (\), and CR/LF/control chars (which would break the ^FS
// boundary), collapse whitespace, then cap length. Hyphens/dots are preserved
// (part numbers like EB-BRN / 620.308.2211 depend on them).
function z(value: string | undefined, max = 42): string {
  const stripped = (value ?? '')
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0)
      if (c < 0x20) return ' ' // control chars incl. CR/LF
      if (ch === '^' || ch === '~' || ch === '\\') return ' '
      return ch
    })
    .join('')
  return stripped.replace(/\s+/g, ' ').trim().slice(0, max)
}

export function buildPalletZpl(label: PalletLabel): string {
  const itemCode = z(label.itemCode, 28)
  const itemName = z(label.itemName, 42)
  const customer = z(label.customer, 38)
  const ref = z(label.ref, 38)
  const batch = z(label.batch, 40)
  const uom = z(label.uom || 'pcs', 8)
  const qty = Number.isFinite(label.qty) ? Math.max(0, Math.round(label.qty)) : 0

  // ^CI28 = UTF-8. Lines are laid out top-to-bottom on the 812x1218 portrait media.
  const lines = [
    '^XA',
    '^PW812',
    '^LL1218',
    '^CI28',
    '^LH0,0',
    // Header
    '^FO40,40^A0N,64,64^FDENTECH^FS',
    '^FO40,118^GB732,3,3^FS',
    // Internal part number (prominent)
    '^FO40,150^A0N,34,34^FDPART No.^FS',
    `^FO40,190^A0N,90,90^FD${itemCode}^FS`,
    // Description
    `^FO40,300^A0N,38,38^FD${itemName}^FS`,
    // Quantity (prominent)
    `^FO40,372^A0N,72,72^FDQTY: ${qty} ${uom}^FS`,
    // Customer + reference
    customer ? `^FO40,470^A0N,34,34^FDCustomer: ${customer}^FS` : '',
    ref ? `^FO40,516^A0N,30,30^FDRef: ${ref}^FS` : '',
    // Divider above the scan zone
    '^FO40,580^GB732,3,3^FS',
    // QR (batch id) — bottom-right, multi-purpose (ship / transfer / lookup)
    `^FO470,620^BQN,2,8^FDQA,${batch}^FS`,
    // Batch id printed (human-readable) bottom-left
    '^FO40,640^A0N,30,30^FDPALLET^FS',
    `^FO40,680^A0N,40,40^FD${batch}^FS`,
    '^XZ',
  ]
  return lines.filter(Boolean).join('\n')
}
