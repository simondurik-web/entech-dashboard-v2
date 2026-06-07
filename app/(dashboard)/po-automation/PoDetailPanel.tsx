'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, ImageOff, Pencil, History, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { useAuth } from '@/lib/auth-context'
import { usePermissions } from '@/lib/use-permissions'
import { PoMediaThumbs, type PoMediaItem } from '@/components/po-automation/PoMediaThumbs'
import { BillOfLadingSection } from '@/components/po-automation/BillOfLadingSection'
import { isSafeStorageUrl } from '@/lib/po-automation/safe-url'
import { PoEditModal } from './PoEditModal'
import type { ProcessedPo } from '@/lib/po-automation/types'
import type { PoAuditEntry } from '@/lib/po-automation/edit'

/** Friendly label for a screenshot derived from its filename. */
function screenshotLabel(url: string): string {
  try {
    const file = decodeURIComponent(url.split('/').pop() ?? '')
    return file.replace(/\.[a-z0-9]+$/i, '')
  } catch {
    return url
  }
}

/**
 * Row-detail panel for a PO record: shows the customer's original PO PDF
 * (inline iframe + open-full link) and the Codex proof screenshots
 * (thumbnail gallery + click-to-enlarge lightbox).
 */
export function PoDetailPanel({ po, onChanged }: { po: ProcessedPo; onChanged?: () => void }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const { canAccess } = usePermissions()
  const canEdit = canAccess('/po-automation')
  const userId = user?.id ?? null
  const screenshots = Array.isArray(po.screenshot_urls)
    ? po.screenshot_urls.filter((u): u is string => typeof u === 'string' && isSafeStorageUrl(u))
    : []
  const pdfUrl =
    typeof po.po_pdf_url === 'string' && isSafeStorageUrl(po.po_pdf_url) ? po.po_pdf_url : null
  // Compact thumbnails — PO PDF first, then screenshots; expand/download in a modal.
  const media: PoMediaItem[] = []
  if (pdfUrl) media.push({ url: pdfUrl, kind: 'pdf', label: t('po.detail.originalPo') })
  for (const url of screenshots) media.push({ url, kind: 'image', label: screenshotLabel(url) })

  const [editOpen, setEditOpen] = useState(false)

  // Audit history for this PO (newest first). The fetch's setHistory calls live
  // in async .then/.catch callbacks (allowed), not synchronously in the effect.
  const [history, setHistory] = useState<PoAuditEntry[]>([])
  const loadHistory = useCallback(() => {
    if (!canEdit) return
    fetch(`/api/po-automation/${po.id}`, {
      headers: { 'x-user-id': userId || '' },
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((data) => setHistory(Array.isArray(data?.entries) ? data.entries : []))
      .catch(() => setHistory([]))
  }, [po.id, userId, canEdit])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const fmtDate = (value: string | null) => {
    if (!value) return ''
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
  }

  // Source-email metadata: where the PO was retrieved from and when. The orchestrator
  // stores this under payload._email; source_inbox is also a top-level column. Older
  // POs (entered before this was captured) won't have it, so the section self-hides.
  const emailMeta = (po.payload?._email ?? null) as Record<string, unknown> | null
  const emailStr = (k: string): string => {
    const v = emailMeta?.[k]
    return typeof v === 'string' ? v : ''
  }
  const sourceInbox = emailStr('inbox') || (typeof po.source_inbox === 'string' ? po.source_inbox : '')
  const emailFrom = emailStr('from') || emailStr('sender')
  const emailSubject = emailStr('subject')
  const retrievedAt = emailStr('retrieved_at')
  const emailDate = emailStr('email_date')
  const hasEmailInfo = Boolean(sourceInbox || emailFrom || retrievedAt || emailSubject || emailDate)

  return (
    <div className="space-y-4">
      {/* Edit toolbar — only for users who can access /po-automation */}
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" />
            {t('po.edit.button')}
          </Button>
        </div>
      )}

      {/* PO PDF + Fusion screenshots — compact thumbnails (click to expand/download) */}
      <section className="min-w-0">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <FileText className="size-4" />
          {t('po.detail.documentsTitle')}
          {media.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({media.length})</span>
          )}
        </h3>
        {media.length > 0 ? (
          <PoMediaThumbs items={media} size="lg" />
        ) : (
          <div className="flex items-center gap-1.5 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <ImageOff className="size-4" />
            {t('po.detail.noScreenshots')}
          </div>
        )}
      </section>

      {/* Source email — where this PO came from and when we retrieved it */}
      {hasEmailInfo && (
        <section className="min-w-0">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Mail className="size-4" />
            {t('po.detail.sourceEmailTitle')}
          </h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/20 p-2.5 text-xs">
            {emailFrom && (
              <>
                <dt className="text-muted-foreground">{t('po.detail.emailFrom')}</dt>
                <dd className="min-w-0 break-words font-medium">{emailFrom}</dd>
              </>
            )}
            {sourceInbox && (
              <>
                <dt className="text-muted-foreground">{t('po.detail.emailInbox')}</dt>
                <dd className="min-w-0 break-words">{sourceInbox}</dd>
              </>
            )}
            {emailSubject && (
              <>
                <dt className="text-muted-foreground">{t('po.detail.emailSubject')}</dt>
                <dd className="min-w-0 break-words">{emailSubject}</dd>
              </>
            )}
            {/* Chronological: when the customer sent it, then when our automation pulled it.
                email_date is an RFC-2822 header string — format it, falling back to raw. */}
            {emailDate && (
              <>
                <dt className="text-muted-foreground">{t('po.detail.emailDate')}</dt>
                <dd className="min-w-0 break-words">{fmtDate(emailDate) || emailDate}</dd>
              </>
            )}
            {retrievedAt && (
              <>
                <dt className="text-muted-foreground">{t('po.detail.emailRetrieved')}</dt>
                <dd>{fmtDate(retrievedAt)}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* Bill of Lading — role-gated, full-width panel */}
      {canEdit && po.po_number && (
        <BillOfLadingSection
          key={`bol|${po.party ?? ''}|${po.po_number}`}
          customer={po.party ?? ''}
          poNumber={po.po_number}
          userId={userId}
          variant="panel"
        />
      )}

      {/* History / Changes */}
      {canEdit && history.length > 0 && (
        <section className="min-w-0">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <History className="size-4" />
            {t('po.history.title')}
            <span className="text-xs font-normal text-muted-foreground">({history.length})</span>
          </h3>
          <ul className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-md border bg-muted/20 p-2.5 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {entry.changed_by_name || entry.changed_by || t('po.history.someone')}
                  </span>
                  <span>{fmtDate(entry.changed_at)}</span>
                </div>
                {Array.isArray(entry.changes) && entry.changes.length > 0 && (
                  <ul className="space-y-0.5">
                    {entry.changes.map((c, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-1">
                        <span className="font-mono text-[11px] text-muted-foreground">{c.field}:</span>
                        <span className="text-red-600 line-through dark:text-red-400">
                          {c.old === null || c.old === undefined || c.old === '' ? '∅' : String(c.old)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-green-600 dark:text-green-400">
                          {c.new === null || c.new === undefined || c.new === '' ? '∅' : String(c.new)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {entry.note && (
                  <p className="mt-1 italic text-muted-foreground">“{entry.note}”</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Edit modal */}
      {canEdit && editOpen && (
        <PoEditModal
          po={po}
          userId={userId}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            loadHistory()
            onChanged?.()
          }}
        />
      )}
    </div>
  )
}
