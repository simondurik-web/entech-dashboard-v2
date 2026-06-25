'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollText, Upload, Trash2, ImageIcon, Loader2 } from 'lucide-react'
import { PoMediaThumbs, type PoMediaItem } from '@/components/po-automation/PoMediaThumbs'
import { isSafeStorageUrl } from '@/lib/po-automation/safe-url'
import { useI18n } from '@/lib/i18n'
import type { OrderDocument } from '@/lib/po-automation/documents'
import { authHeaders } from '@/lib/session-token'

function isPdf(doc: OrderDocument): boolean {
  return /\.pdf($|\?)/i.test(doc.file_url ?? '') || /\.pdf$/i.test(doc.file_name ?? '')
}

/**
 * Bill of Lading section — lists any BOLs for an order as compact thumbnails
 * (PoMediaThumbs — click to expand/download) and exposes an "Add BOL" upload
 * control with per-doc number/notes/delete. Role-gated by the
 * caller (only mounted for users who can access /po-automation), so the fetch
 * never fires for unpermitted users. Reused by OrderDetail + PoDetailPanel.
 */
export function BillOfLadingSection({
  customer,
  poNumber,
  userId,
  variant = 'card',
}: {
  customer: string
  poNumber: string
  userId: string | null
  /** 'card' = compact amber card (OrderDetail); 'panel' = wider (PoDetailPanel). */
  variant?: 'card' | 'panel'
}) {
  const { t } = useI18n()
  const [docs, setDocs] = useState<OrderDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [docNumber, setDocNumber] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // Bumped on every (re)load to invalidate in-flight responses — a stale fetch
  // (e.g. one started before an upload/delete) must not overwrite a newer list.
  const loadSeq = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    const active = () => seq === loadSeq.current
    setLoading(true)
    try {
      const qs = new URLSearchParams({ customer, po: poNumber }).toString()
      const res = await fetch(`/api/po-automation/documents?${qs}`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      const data = res.ok ? await res.json() : { documents: [] }
      if (active()) setDocs(Array.isArray(data?.documents) ? data.documents : [])
    } catch {
      if (active()) setDocs([])
    } finally {
      if (active()) setLoading(false)
    }
  }, [customer, poNumber, userId])

  // The caller remounts via key on (customer, poNumber); initial state already
  // resets per lookup. State updates only happen in async callbacks.
  useEffect(() => {
    void load()
  }, [load])

  const handleUpload = useCallback(async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError(t('po.bol.noFile'))
      return
    }
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('customer', customer)
      fd.append('po', poNumber)
      fd.append('doc_type', 'bol')
      if (docNumber.trim()) fd.append('doc_number', docNumber.trim())
      if (note.trim()) fd.append('notes', note.trim())
      const res = await fetch('/api/po-automation/documents', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || `HTTP ${res.status}`)
      }
      setDocNumber('')
      setNote('')
      setShowForm(false)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('po.bol.uploadError'))
    } finally {
      setUploading(false)
    }
  }, [customer, poNumber, userId, docNumber, note, t, load])

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t('po.bol.deleteConfirm'))) return
      try {
        const res = await fetch(`/api/po-automation/documents?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        })
        if (res.ok) await load()
      } catch {
        /* ignore */
      }
    },
    [userId, load, t]
  )

  const isPanel = variant === 'panel'
  const textXs = isPanel ? 'text-xs' : 'text-[10px]'

  return (
    <div
      className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5"
      style={{ borderTopWidth: 2, borderTopColor: 'rgb(245, 158, 11)' }}
    >
      <h4 className={`mb-2 flex items-center gap-1.5 font-semibold text-amber-500 ${isPanel ? 'text-sm' : 'text-xs'}`}>
        <ScrollText className={isPanel ? 'size-4' : 'size-3'} /> {t('po.bol.title')}
        {docs.length > 0 && (
          <span className="ml-auto rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px]">{docs.length}</span>
        )}
      </h4>

      {loading ? (
        <div className={`flex items-center gap-2 py-2 ${textXs} text-muted-foreground`}>
          <Loader2 className="size-3 animate-spin" />
          {t('ui.loading')}
        </div>
      ) : (
        <div className="space-y-2">
          {docs.length === 0 ? (
            <p className={`${textXs} text-muted-foreground`}>{t('po.bol.empty')}</p>
          ) : (
            docs.map((doc) => {
              const safe = isSafeStorageUrl(doc.file_url)
              const label = doc.doc_number
                ? `${t('po.bol.number')} ${doc.doc_number}`
                : doc.file_name || t('po.bol.title')
              const media: PoMediaItem[] = safe
                ? [{ url: doc.file_url!, kind: isPdf(doc) ? 'pdf' : 'image', label }]
                : []
              return (
                <div key={doc.id} className="flex items-start gap-2 rounded-md border bg-background/60 p-2">
                  {/* Small thumbnail — click to expand/download */}
                  {safe ? (
                    <PoMediaThumbs items={media} size={isPanel ? 'md' : 'sm'} />
                  ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
                      <ImageIcon className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-medium ${isPanel ? 'text-xs' : 'text-[11px]'}`}>{label}</p>
                    {doc.notes && <p className={`truncate ${textXs} text-muted-foreground`}>{doc.notes}</p>}
                    {doc.uploaded_by_name && (
                      <p className={`${textXs} text-muted-foreground`}>
                        {t('po.bol.uploadedBy')} {doc.uploaded_by_name}
                      </p>
                    )}
                    {!safe && (
                      <p className={`${textXs} text-muted-foreground`}>{t('po.bol.unavailable')}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(doc.id)}
                    aria-label={t('po.bol.delete')}
                    title={t('po.bol.delete')}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              )
            })
          )}

          {/* Add BOL control */}
          {showForm ? (
            <div className="space-y-2 rounded-md border border-dashed p-2">
              <input
                type="text"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                placeholder={t('po.bol.numberPlaceholder')}
                className="w-full rounded border bg-background px-2 py-1 text-xs"
              />
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-amber-500/15 file:px-2 file:py-1 file:text-xs file:text-amber-600"
              />
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('po.bol.notePlaceholder')}
                className="w-full rounded border bg-background px-2 py-1 text-xs"
              />
              {error && <p className="text-[10px] text-red-500">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleUpload()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                  {t('po.bol.upload')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    setError(null)
                  }}
                  disabled={uploading}
                  className="rounded border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
                >
                  {t('ui.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1 rounded border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10"
            >
              <Upload className="size-3" />
              {t('po.bol.add')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
