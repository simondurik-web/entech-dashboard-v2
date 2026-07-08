// THE one place a scanned/typed code becomes a pallet id. Every scanner —
// current and future — must use this instead of writing its own regex: the
// 2026-07-08 incident happened because the camera scanner's private pattern
// didn't know the "-02" reprint suffix, silently truncating 33R5-02 to the
// RETIRED serial 33R5 and rejecting every reprinted label on the ship flow.
// The behavior is locked by lib/pallet-code.test.ts.
//
// Serial shape (see generatePalletId / nextSerial in lib/erpnext/inventory.ts):
//   base    = 3-12 chars of Crockford base32 (digits + A-Z minus I, L, O, U)
//   reprint = base + "-NN" (2-3 digits), e.g. D79C -> D79C-02 -> D79C-03

// The suffixed alternative is tried FIRST and only wins when the digits end
// the alphanumeric run (lookahead) — so a part-number-ish scan like
// CURB-36PK extracts exactly the same token it did before suffix support.
export const PALLET_CODE =
  /[0-9A-HJKMNP-TV-Z]{3,12}-\d{2,3}(?![0-9A-Z])|[0-9A-HJKMNP-TV-Z]{3,12}/

/** Extract the pallet code from a raw scan/QR payload. Tolerates prefixed
 *  payloads (takes the segment after the last comma) and lowercase input;
 *  falls back to the trimmed uppercased raw text when nothing matches. */
export function extractPalletCode(raw: string): string {
  const tail = raw.includes(',') ? raw.slice(raw.lastIndexOf(',') + 1) : raw
  const m = tail.toUpperCase().match(PALLET_CODE)
  return m ? m[0] : tail.trim().toUpperCase()
}
