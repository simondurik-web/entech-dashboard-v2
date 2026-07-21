'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollText, Upload, Trash2, ImageIcon, Loader2, Pencil, Printer } from 'lucide-react'
import { PoMediaThumbs, type PoMediaItem } from '@/components/po-automation/PoMediaThumbs'
import { WatermarkedPreview } from '@/components/po-automation/WatermarkedPreview'
import { isSafeStorageUrl } from '@/lib/po-automation/safe-url'
import { useI18n } from '@/lib/i18n'
import { authHeaders } from '@/lib/session-token'
import { compressImageForUpload } from '@/lib/compress-image'
import type { OrderDocument } from '@/lib/po-automation/documents'

function isPdf(doc: OrderDocument): boolean {
  return /\.pdf($|\?)/i.test(doc.file_url ?? '') || /\.pdf$/i.test(doc.file_name ?? '')
}

/**
 * Bill of Lading section. Lists an order's BOLs and exposes upload / edit-replace
 * / delete for users allowed to manage shipping BOLs (Admin / Manager / Shipping
 * Manager — `canManage`).
 *
 * Print gating is by shipment status:
 *  - `shipped=false` (Ready to Ship): each BOL shows as a WATERMARKED, non-
 *    printable preview — visible for verification, but no clean/printable copy.
 *  - `shipped=true` (Shipped): the clean BOL is shown via PoMediaThumbs (open +
 *    download) so it can be reprinted, because the load is already out.
 */
export function BillOfLadingSection({
  customer,
  poNumber,
  soName = '',
  variant = 'card',
  shipped = false,
  canManage = false,
  watermarkUntilShipped = false,
}: {
  customer: string
  poNumber: string
  /**
   * ERPNext Sales Order of the hosting order line. When set (per-SO surfaces:
   * Orders Data, Shipping Overview) the list shows only this SO's BOLs plus
   * untagged order-level ones, and new uploads are tagged to this SO — a
   * multi-SO PO (e.g. Amazon FBA, one BOL per destination) files each BOL
   * against its own sales order (Simon 2026-07-21). Empty (PO panel) keeps the
   * PO-wide view and untagged uploads.
   */
  soName?: string
  /** Retained for caller compatibility; auth now rides the session token. */
  userId?: string | null
  /** 'card' = compact amber card (OrderDetail); 'panel' = wider (PoDetailPanel). */
  variant?: 'card' | 'panel'
  /** Shipment status — gates whether a clean (printable) copy is shown. */
  shipped?: boolean
  /** Whether the viewer may upload / edit / delete BOLs. */
  canManage?: boolean
  /**
   * Shipping surface only: when true, a not-yet-shipped BOL renders watermarked +
   * non-printable, and the clean copy unlocks once `shipped`. Default false keeps
   * the original clean, always-uploadable behavior for the PO-Automation surfaces.
   */
  watermarkUntilShipped?: boolean
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
  // Inline edit/replace state (one row at a time).
  const [editId, setEditId] = useState<string | null>(null)
  const [editNumber, setEditNumber] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editBusy, setEditBusy] = useState(false)
  const editFileRef = useRef<HTMLInputElement>(null)
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
      // BOLs only — ERP-entry proofs (doc_type='erp_entry') belong to the
      // "PO & ERP Entry" section, not here. Legacy rows have doc_type='bol'.
      // On a per-SO surface, a BOL tagged to a DIFFERENT sales order of the
      // same PO belongs to that order's line, not this one.
      const rows: OrderDocument[] = Array.isArray(data?.documents) ? data.documents : []
      if (active())
        setDocs(
          rows.filter(
            (d) =>
              (d.doc_type ?? 'bol') === 'bol' &&
              (!soName || !d.so_number?.trim() || d.so_number.trim() === soName)
          )
        )
    } catch {
      if (active()) setDocs([])
    } finally {
      if (active()) setLoading(false)
    }
  }, [customer, poNumber, soName])

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
      // Phone photos of a BOL can exceed the ~4.5 MB request cap; PDFs pass
      // through compressImageForUpload untouched.
      fd.append('file', await compressImageForUpload(file))
      fd.append('customer', customer)
      fd.append('po', poNumber)
      if (soName) fd.append('so', soName)
      fd.append('doc_type', 'bol')
      if (docNumber.trim()) fd.append('doc_number', docNumber.trim())
      if (note.trim()) fd.append('notes', note.trim())
      const res = await fetch('/api/po-automation/documents', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      })
      if (!res.ok) {
        if (res.status === 413) throw new Error(t('photos.tooLarge'))
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
  }, [customer, poNumber, soName, docNumber, note, t, load])

  const openEdit = useCallback((doc: OrderDocument) => {
    setEditId(doc.id)
    setEditNumber(doc.doc_number ?? '')
    setEditNote(doc.notes ?? '')
    setError(null)
    if (editFileRef.current) editFileRef.current.value = ''
  }, [])

  const handleUpdate = useCallback(
    async (id: string) => {
      setEditBusy(true)
      setError(null)
      try {
        const fd = new FormData()
        fd.append('id', id)
        fd.append('doc_number', editNumber.trim())
        fd.append('notes', editNote.trim())
        const f = editFileRef.current?.files?.[0]
        if (f) fd.append('file', await compressImageForUpload(f))
        const res = await fetch('/api/po-automation/documents', {
          method: 'PATCH',
          headers: authHeaders(),
          body: fd,
        })
        if (!res.ok) {
          if (res.status === 413) throw new Error(t('photos.tooLarge'))
          const j = await res.json().catch(() => ({}))
          throw new Error(j?.error || `HTTP ${res.status}`)
        }
        setEditId(null)
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : t('po.bol.editError'))
      } finally {
        setEditBusy(false)
      }
    },
    [editNumber, editNote, t, load]
  )

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
    [load, t]
  )

  const isPanel = variant === 'panel'
  const textXs = isPanel ? 'text-xs' : 'text-[10px]'
  // A BOL is hidden behind the watermark only on the shipping surface and only
  // until the load ships. Everywhere else (and once shipped) the clean copy shows.
  const watermarked = watermarkUntilShipped && !shipped

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
              const editing = editId === doc.id
              return (
                <div key={doc.id} className="space-y-2 rounded-md border bg-background/60 p-2">
                  <div className="flex items-start gap-2">
                    {/* Thumbnail: clean (shipped) opens via PoMediaThumbs; unsafe url shows a placeholder */}
                    {!safe ? (
                      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-muted-foreground">
                        <ImageIcon className="size-4" />
                      </div>
                    ) : !watermarked ? (
                      <PoMediaThumbs items={media} size={isPanel ? 'md' : 'sm'} />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className={`flex items-center gap-1.5 font-medium ${isPanel ? 'text-xs' : 'text-[11px]'}`}>
                        <span className="truncate">{label}</span>
                        {doc.so_number?.trim() && (
                          <span
                            title={t('po.bol.soLinked').replace('{so}', doc.so_number.trim())}
                            className="shrink-0 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-600 dark:text-cyan-300"
                          >
                            {doc.so_number.trim()}
                          </span>
                        )}
                      </p>
                      {doc.notes && <p className={`truncate ${textXs} text-muted-foreground`}>{doc.notes}</p>}
                      {doc.uploaded_by_name && (
                        <p className={`${textXs} text-muted-foreground`}>
                          {t('po.bol.uploadedBy')} {doc.uploaded_by_name}
                        </p>
                      )}
                      {watermarkUntilShipped && shipped && safe && (
                        <p className={`flex items-center gap-1 ${textXs} text-emerald-600`}>
                          <Printer className="size-3" /> {t('po.bol.reprintHint')}
                        </p>
                      )}
                      {!safe && <p className={`${textXs} text-muted-foreground`}>{t('po.bol.unavailable')}</p>}
                    </div>
                    {canManage && !editing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(doc)}
                          aria-label={t('po.bol.edit')}
                          title={t('po.bol.edit')}
                          className="rounded p-1 text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc.id)}
                          aria-label={t('po.bol.delete')}
                          title={t('po.bol.delete')}
                          className="rounded p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Watermarked, non-printable preview shown until the load ships */}
                  {watermarked && safe && (
                    <WatermarkedPreview
                      url={doc.file_url!}
                      kind={isPdf(doc) ? 'pdf' : 'image'}
                      stampText={t('po.bol.wmStamp')}
                      disclaimer={t('po.bol.wmDisclaimer')}
                    />
                  )}

                  {/* Inline edit / replace form */}
                  {editing && (
                    <div className="space-y-2 rounded-md border border-dashed p-2">
                      <input
                        type="text"
                        value={editNumber}
                        onChange={(e) => setEditNumber(e.target.value)}
                        placeholder={t('po.bol.numberPlaceholder')}
                        className="w-full rounded border bg-background px-2 py-1 text-xs"
                      />
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder={t('po.bol.notePlaceholder')}
                        className="w-full rounded border bg-background px-2 py-1 text-xs"
                      />
                      <label className={`block ${textXs} text-muted-foreground`}>{t('po.bol.replaceFile')}</label>
                      <input
                        ref={editFileRef}
                        type="file"
                        accept="application/pdf,image/png,image/jpeg,image/webp"
                        className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-amber-500/15 file:px-2 file:py-1 file:text-xs file:text-amber-600"
                      />
                      {error && <p className="text-[10px] text-red-500">{error}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleUpdate(doc.id)}
                          disabled={editBusy}
                          className="inline-flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                        >
                          {editBusy ? <Loader2 className="size-3 animate-spin" /> : null}
                          {t('po.bol.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditId(null)
                            setError(null)
                          }}
                          disabled={editBusy}
                          className="rounded border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
                        >
                          {t('ui.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* Add BOL control — managers only */}
          {canManage &&
            (showForm ? (
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
                {soName && (
                  <p className="text-[10px] text-muted-foreground">
                    {t('po.bol.soHint').replace('{so}', soName)}
                  </p>
                )}
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
                onClick={() => {
                  setShowForm(true)
                  setError(null)
                }}
                className="inline-flex items-center gap-1 rounded border border-amber-500/30 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10"
              >
                <Upload className="size-3" />
                {t('po.bol.add')}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
