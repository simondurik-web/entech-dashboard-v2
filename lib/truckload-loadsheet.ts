// Unified truckload load sheet — ONE document whether printed from the
// Truckloads panel or right after creating the load in the Pallet Load
// Calculator (Simon 2026-07-16: the two prints used to differ — the creation
// report had customer part numbers but no TL number/notes/pallet IDs, the
// load sheet had the reverse. This is now the single format for both).

export interface LoadSheetOrder {
  so_number: string
  line: number | null
  customer: string | null
  part_number: string | null
  customer_part_number?: string | null
  pallet_ids?: string[]
  pallet_count: number | null
  total_weight_lb?: number | null // summed pallet weights (Simon 2026-07-20: like the Pallet Load Report)
  status: 'pending' | 'shipped' | 'released'
  dn_number: string | null
}

export interface LoadSheetInput {
  loadNumber: string
  createdAt: string
  createdByName: string | null
  notes: string | null
  /** trailer diagram snapshotted at creation */
  svgMarkup: string | null
  orders: LoadSheetOrder[]
  /** i18n lookup — TruckloadsPanel passes useI18n's t, the calculator a locale-dict lookup */
  t: (key: string) => string
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c])

// The diagram snapshot is client-produced markup persisted in calculator_state
// — anyone with PATCH access could store a hostile payload that would run in
// the next viewer's print window. Rebuild it through DOMParser keeping only
// drawing elements and dropping scripts/handlers/links.
const SVG_ALLOWED_TAGS = new Set([
  'svg', 'g', 'rect', 'text', 'tspan', 'line', 'path', 'circle', 'ellipse',
  'polygon', 'polyline', 'marker', 'defs', 'title',
])
function sanitizeSvgMarkup(markup: string | null): string {
  if (!markup || typeof window === 'undefined') return ''
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return ''
  const scrubAttrs = (el: Element) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || name === 'src' || name === 'style') {
        el.removeAttribute(attr.name)
      }
    }
  }
  const scrub = (el: Element) => {
    for (const node of [...el.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node as Element
        if (!SVG_ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
          child.remove()
          continue
        }
        scrubAttrs(child)
        scrub(child)
      } else if (node.nodeType !== Node.TEXT_NODE) {
        // processing instructions / comments / CDATA parse differently once
        // document.write re-reads this as HTML — an XML-legal PI can smuggle a
        // live <script> through that mismatch, so only elements and text survive
        node.remove()
      }
    }
  }
  scrubAttrs(root)
  scrub(root)
  return new XMLSerializer().serializeToString(root)
}

export function buildLoadSheetHtml({ loadNumber, createdAt, createdByName, notes, svgMarkup, orders, t }: LoadSheetInput): string {
  const totalPallets = orders.reduce((s, o) => s + (o.pallet_count ?? 0), 0)
  // Weight totals like the Pallet Load Report (Simon 2026-07-20). Shown only
  // when at least one order carries a known weight — an all-unknown sheet
  // prints dashes rather than a misleading 0.
  const totalWeight = orders.reduce((s, o) => s + (o.total_weight_lb ?? 0), 0)
  const lbs = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) && v > 0 ? `${Math.round(v).toLocaleString()} lbs` : '—'
  const rowsHtml =
    orders
      .map(
        (o, i) => `<tr>
          <td style="text-align:center;">${i + 1}</td>
          <td style="font-family:monospace;font-weight:700;">${esc(o.so_number)}</td>
          <td style="text-align:center;">${o.line ?? '—'}</td>
          <td>${esc(o.customer ?? '')}</td>
          <td>${esc(o.part_number ?? '')}</td>
          <td style="font-weight:700;">${esc(o.customer_part_number ?? '') || '—'}</td>
          <td style="font-family:monospace;font-size:10px;">${esc((o.pallet_ids ?? []).join(', ')) || '—'}</td>
          <td style="text-align:center;font-weight:700;">${o.pallet_count ?? '—'}</td>
          <td style="text-align:right;font-weight:700;white-space:nowrap;">${lbs(o.total_weight_lb)}</td>
          <td style="text-align:center;">${
            o.status === 'shipped'
              ? `${esc(t('truckload.chipShipped'))}${o.dn_number ? ` (${esc(o.dn_number)})` : ''}`
              : o.status === 'released'
                ? esc(t('truckload.chipReleased'))
                : esc(t('truckload.chipPending'))
          }</td>
        </tr>`
      )
      .join('') +
    `<tr style="background:#ede9fe;font-weight:700;">
      <td colspan="7" style="text-align:right;">${esc(t('truckload.palletsTotal'))}</td>
      <td style="text-align:center;">${totalPallets || '—'}</td>
      <td style="text-align:right;white-space:nowrap;">${lbs(totalWeight)}</td>
      <td></td>
    </tr>`

  // the pickup-reference notice embeds the TL number in bold
  const refNotice = esc(t('truckload.sheetRefNotice')).replace('{tl}', `<b>${esc(loadNumber)}</b>`)

  return `<!DOCTYPE html><html><head><title>${esc(loadNumber)}</title><style>
    body { font-family: Arial, sans-serif; margin: 16px; color: #1a1a2e; }
    .header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-bottom: 8px; }
    h1 { font-size: 18px; margin: 0 0 2px; } .meta { color:#666; font-size: 11px; }
    .tl-number { font-family: monospace; font-size: 36px; font-weight: 800; letter-spacing: 2px; text-align: center; }
    .ref { background:#fef9c3; border:2px solid #eab308; color:#713f12; border-radius:8px; padding:10px 12px; font-weight:700; font-size:13px; margin-bottom:10px; }
    .warn { background:#f5f3ff; border:2px solid #7c3aed; color:#5b21b6; border-radius:8px; padding:10px 12px; font-weight:700; font-size:13px; margin-bottom:12px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
    th { background: #5b21b6; color: white; padding: 5px 8px; text-align: left; font-size: 11px; }
    td { font-size: 11px; padding: 4px 8px; border: 1px solid #ddd; }
    .notes { background:#fffbeb; border:1px solid #f59e0b; border-radius:8px; padding:8px 12px; font-size:12px; margin-bottom:12px; white-space:pre-wrap; }
    .diagram-tl { text-align:center; font-family:monospace; font-size:20px; font-weight:800; letter-spacing:1.5px; margin:6px 0 2px; }
    .diagram svg { width: 100%; max-height: 300px; color:#333; } .diagram svg text { fill:#333; }
    @media print { .no-print { display:none; } } @page { margin: 8mm; }
  </style></head><body>
    <div class="header">
      <div>
        <h1>🚛 ${esc(t('truckload.sheetTitle'))}</h1>
        <div class="meta">${esc(new Date(createdAt).toLocaleString())} · ${esc(createdByName ?? '')}</div>
      </div>
      <div class="tl-number">${esc(loadNumber)}</div>
      <div></div>
    </div>
    <div class="ref">📌 ${refNotice}</div>
    <div class="warn">${esc(t('truckload.sheetWarn')).replace('{count}', String(orders.length))}</div>
    ${notes ? `<div class="notes"><b>${esc(t('truckload.notes'))}:</b> ${esc(notes)}</div>` : ''}
    <table><thead><tr><th>#</th><th>SO</th><th>${esc(t('truckload.line'))}</th><th>${esc(t('table.customer'))}</th><th>${esc(t('table.partNumber'))}</th><th>${esc(t('table.customerPart'))}</th><th>${esc(t('truckload.palletIds'))}</th><th>${esc(t('truckload.pallets'))}</th><th style="text-align:right;">${esc(t('truckload.weight'))}</th><th>${esc(t('truckload.orderStatus'))}</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    ${(() => {
      const safeSvg = sanitizeSvgMarkup(svgMarkup)
      return safeSvg ? `<div class="diagram"><div class="diagram-tl">${esc(loadNumber)}</div>${safeSvg}</div>` : ''
    })()}
    <div class="no-print" style="text-align:center;margin-top:16px;">
      <button onclick="window.print()" style="padding:10px 24px;background:#5b21b6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;">🖨️ ${esc(t('truckload.printSheet'))}</button>
    </div>
  </body></html>`
}

/** Open the print window SYNCHRONOUSLY from the click handler (before any
 *  await) — Safari drops user activation across a network round-trip and
 *  blocks the popup otherwise. Returns null when the browser blocked it. */
export function openPrintShell(): Window | null {
  const win = window.open('', '_blank')
  if (win) win.opener = null
  return win
}

export function writePrintHtml(win: Window, html: string): void {
  win.document.write(html)
  win.document.close()
}
