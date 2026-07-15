'use client'

import { useEffect, useState } from 'react'
import { FileText, Inbox } from 'lucide-react'
import { PoMediaThumbs, type PoMediaItem } from '@/components/po-automation/PoMediaThumbs'
import { BillOfLadingSection } from '@/components/po-automation/BillOfLadingSection'
import { ErpShippingDocs } from '@/components/po-automation/ErpShippingDocs'
import { useErpEntryDocs, isPdfDoc } from '@/components/po-automation/useErpEntryDocs'
import { isSafeStorageUrl } from '@/lib/po-automation/safe-url'
import { useI18n } from '@/lib/i18n'
import { authHeaders } from '@/lib/session-token'

interface PoMatch {
  po_pdf_url: string | null
  screenshot_urls: string[] | null
  so_numbers: string | null
}

/**
 * Shipping-overview surface for the PO PDF + any BOLs of an order, mapped by
 * customer + poNumber. Role-gated by the caller (only mounted when the viewer
 * can access /po-automation), so no fetch fires for unpermitted users.
 */
export function OrderPoBolSection({
  customer,
  poNumber,
  userId,
  shipped = false,
  canManage = false,
  showPoEntry = true,
  soName = '',
}: {
  customer: string
  poNumber: string
  userId: string | null
  /** Shipment status — drives the BOL watermark/reprint gating. */
  shipped?: boolean
  /** Whether the viewer may upload / edit / delete the BOL. */
  canManage?: boolean
  /** Show the PO & ERP-entry block (needs PO-Automation access). Hidden for
   *  shipping managers who can manage the BOL but can't see PO data. */
  showPoEntry?: boolean
  /** ERPNext Sales Order name — enables the generated BOL/packing-slip list. */
  soName?: string
}) {
  const { t } = useI18n()
  const [match, setMatch] = useState<PoMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const erpEntryDocs = useErpEntryDocs(customer, poNumber, showPoEntry)

  // The caller remounts via key on (customer, poNumber); initial state resets
  // per lookup. State updates only happen in async callbacks.
  useEffect(() => {
    // When the PO entry is hidden we skip the fetch entirely; `loading` is only
    // read inside the (then-unrendered) PO section, so no state update is needed.
    if (!showPoEntry) return
    let active = true
    const qs = new URLSearchParams({ customer, po: poNumber }).toString()
    fetch(`/api/po-automation?${qs}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { match: null }))
      .then((data) => {
        if (active) setMatch(data?.match ?? null)
      })
      .catch(() => {
        if (active) setMatch(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [customer, poNumber, userId, showPoEntry])

  const pdfUrl = match && isSafeStorageUrl(match.po_pdf_url) ? match.po_pdf_url : null
  const screenshots = Array.isArray(match?.screenshot_urls)
    ? match!.screenshot_urls.filter((u): u is string => typeof u === 'string' && isSafeStorageUrl(u))
    : []
  const media: PoMediaItem[] = []
  if (pdfUrl) media.push({ url: pdfUrl, kind: 'pdf', label: t('po.detail.originalPo') })
  for (const url of screenshots) media.push({ url, kind: 'image' })
  // ERP-entry proofs (SO verification PDFs) live with the PO, not with the BOLs.
  for (const d of erpEntryDocs)
    media.push({
      url: d.file_url!,
      kind: isPdfDoc(d) ? 'pdf' : 'image',
      label: d.doc_number ? `${t('po.detail.erpEntryProof')} ${d.doc_number}` : t('po.detail.erpEntryProof'),
    })

  return (
    <div className="space-y-3">
      {showPoEntry && (
        <section className="rounded-xl border-l-4 border-l-cyan-500 bg-muted/20 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground">
            <Inbox className="size-4" />
            <span>{t('po.detail.poErpEntry')}</span>
            {match?.so_numbers && (
              <span className="ml-auto rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] tracking-normal text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
                {t('po.detail.soNumbers')} {match.so_numbers}
              </span>
            )}
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">{t('ui.loading')}</p>
          ) : media.length > 0 ? (
            <PoMediaThumbs items={media} size="lg" />
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5" />
              {t('po.detail.noPdf')}
            </p>
          )}
        </section>
      )}

      {/* BOL list + upload (reuses the shared section, full-width panel variant) */}
      <BillOfLadingSection
        key={`bol|${customer}|${poNumber}`}
        customer={customer}
        poNumber={poNumber}
        userId={userId}
        variant="panel"
        watermarkUntilShipped
        shipped={shipped}
        canManage={canManage}
      />

      {/* Generated documents (BOL + packing slip) streamed from ERPNext per
          Delivery Note — self-hides when the order has no submitted DNs. */}
      {soName && <ErpShippingDocs key={`erpdocs|${soName}`} soName={soName} />}
    </div>
  )
}
