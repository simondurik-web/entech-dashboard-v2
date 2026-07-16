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

export function buildLoadSheetHtml({ loadNumber, createdAt, createdByName, notes, svgMarkup, orders, t }: LoadSheetInput): string {
  const totalPallets = orders.reduce((s, o) => s + (o.pallet_count ?? 0), 0)
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
    <table><thead><tr><th>#</th><th>SO</th><th>${esc(t('truckload.line'))}</th><th>${esc(t('table.customer'))}</th><th>${esc(t('table.partNumber'))}</th><th>${esc(t('table.customerPart'))}</th><th>${esc(t('truckload.palletIds'))}</th><th>${esc(t('truckload.pallets'))}</th><th>${esc(t('truckload.orderStatus'))}</th></tr></thead>
    <tbody>${rowsHtml}</tbody></table>
    ${svgMarkup ? `<div class="diagram"><div class="diagram-tl">${esc(loadNumber)}</div>${svgMarkup}</div>` : ''}
    <div class="no-print" style="text-align:center;margin-top:16px;">
      <button onclick="window.print()" style="padding:10px 24px;background:#5b21b6;color:white;border:none;border-radius:6px;cursor:pointer;font-size:14px;">🖨️ ${esc(t('truckload.printSheet'))}</button>
    </div>
  </body></html>`
}

export function openPrintWindow(html: string): void {
  const win = window.open('', '_blank')
  if (win) {
    win.opener = null
    win.document.write(html)
    win.document.close()
  }
}
