'use client'

import { useEffect, useState } from 'react'
import { FileText, Inbox } from 'lucide-react'
import { PdfViewer } from '@/components/ui/PdfViewer'
import { BillOfLadingSection } from '@/components/po-automation/BillOfLadingSection'
import { useI18n } from '@/lib/i18n'

/** Only render/load https URLs hosted on Supabase storage. */
function isSafeStorageUrl(url: string | null | undefined): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.supabase.co')
  } catch {
    return false
  }
}

interface PoMatch {
  po_pdf_url: string | null
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
}: {
  customer: string
  poNumber: string
  userId: string | null
}) {
  const { t } = useI18n()
  const [match, setMatch] = useState<PoMatch | null>(null)
  const [loading, setLoading] = useState(true)

  // The caller remounts via key on (customer, poNumber); initial state resets
  // per lookup. State updates only happen in async callbacks.
  useEffect(() => {
    let active = true
    const qs = new URLSearchParams({ customer, po: poNumber }).toString()
    fetch(`/api/po-automation?${qs}`, { headers: { 'x-user-id': userId || '' } })
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
  }, [customer, poNumber, userId])

  const pdfUrl = match && isSafeStorageUrl(match.po_pdf_url) ? match.po_pdf_url : null

  return (
    <div className="space-y-3">
      <section className="rounded-xl border-l-4 border-l-cyan-500 bg-muted/20 p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-foreground">
          <Inbox className="size-4" />
          <span>{t('po.detail.poFusionEntry')}</span>
          {match?.so_numbers && (
            <span className="ml-auto rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] tracking-normal text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300">
              {t('po.detail.soNumbers')} {match.so_numbers}
            </span>
          )}
        </div>
        {loading ? (
          <p className="text-xs text-muted-foreground">{t('ui.loading')}</p>
        ) : pdfUrl ? (
          <PdfViewer key={pdfUrl} url={pdfUrl} title={t('po.detail.originalPo')} height={300} />
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="size-3.5" />
            {t('po.detail.noPdf')}
          </p>
        )}
      </section>

      {/* BOL list + upload (reuses the shared section, full-width panel variant) */}
      <BillOfLadingSection
        key={`bol|${customer}|${poNumber}`}
        customer={customer}
        poNumber={poNumber}
        userId={userId}
        variant="panel"
        onOpenImage={(url) => window.open(url, '_blank', 'noopener,noreferrer')}
      />
    </div>
  )
}
