'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Camera, Trash2, RotateCcw, Loader2, Image as ImageIcon } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { authHeaders } from '@/lib/session-token'
import { toast } from '@/lib/use-toast'
import { compressImageForUpload } from '@/lib/compress-image'
import { Lightbox } from '@/components/ui/Lightbox'
import type { PurchasingPhoto } from '@/lib/purchasing/photos'

export function PhotoGallery({
  orderId,
  kind,
  title,
  canEdit,
  onChange,
}: {
  orderId: string
  kind: 'item' | 'paperwork'
  title: string
  canEdit: boolean
  /** Called after an upload/delete/restore so the parent can refresh its audit trail / counts. */
  onChange?: () => void
}) {
  const { t } = useI18n()
  const [photos, setPhotos] = useState<PurchasingPhoto[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  const load = useCallback(() => {
    const seq = ++seqRef.current
    setLoading(true)
    const qs = new URLSearchParams({ kind })
    if (showDeleted) qs.set('includeDeleted', '1')
    fetch(`/api/purchasing/${orderId}/photos?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => { if (seq === seqRef.current) setPhotos(d.photos ?? []) })
      .catch(() => { if (seq === seqRef.current) setPhotos([]) })
      .finally(() => { if (seq === seqRef.current) setLoading(false) })
  }, [orderId, showDeleted, kind])
  useEffect(() => { load() }, [load])

  const active = photos.filter((p) => !p.deleted_at)
  const deleted = photos.filter((p) => p.deleted_at)
  const activeUrls = active.map((p) => p.url || '').filter(Boolean)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      // Downscale phone photos client-side, then batch so no single request
      // body exceeds the ~4.5 MB serverless limit (multi-select can pick a
      // dozen photos at once). Compress sequentially: each 12 MP photo decodes
      // to a ~46 MB bitmap, and a dozen in flight at once can crash a mobile
      // Safari tab.
      const compressed: File[] = []
      for (const f of Array.from(files)) {
        compressed.push(await compressImageForUpload(f))
      }
      const MAX_BATCH_BYTES = 3_500_000
      const batches: File[][] = []
      let batch: File[] = []
      let batchBytes = 0
      for (const f of compressed) {
        if (batch.length > 0 && batchBytes + f.size > MAX_BATCH_BYTES) {
          batches.push(batch)
          batch = []
          batchBytes = 0
        }
        batch.push(f)
        batchBytes += f.size
      }
      batches.push(batch)
      for (const b of batches) {
        const fd = new FormData()
        fd.append('kind', kind)
        b.forEach((f) => fd.append('files', f))
        const res = await fetch(`/api/purchasing/${orderId}/photos`, { method: 'POST', headers: authHeaders(), body: fd })
        if (!res.ok) {
          if (res.status === 413) throw new Error(t('photos.tooLarge'))
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || `HTTP ${res.status}`)
        }
      }
    } catch (e) {
      toast({ title: t('purchasing.photos.uploadFailed'), description: e instanceof Error ? e.message : undefined, type: 'error' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
      load() // always reflect actual stored state, even on partial failure
      onChange?.() // earlier batches may have persisted even if a later one failed
    }
  }

  const removePhoto = async (p: PurchasingPhoto) => {
    setLightbox(null)
    try {
      const res = await fetch(`/api/purchasing/photos/${p.id}`, { method: 'DELETE', headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      load(); onChange?.()
    } catch { toast({ title: t('purchasing.photos.deleteFailed'), type: 'error' }) }
  }

  const restorePhoto = async (p: PurchasingPhoto) => {
    try {
      const res = await fetch(`/api/purchasing/photos/${p.id}`, { method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ restore: true }) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      load(); onChange?.()
    } catch { toast({ title: t('purchasing.photos.restoreFailed'), type: 'error' }) }
  }

  return (
    <div>
      {/* Add button on the LEFT so it's reachable without scrolling right. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
              {t('purchasing.photos.add')}
            </button>
            {/* No `capture` attr: lets the phone offer the photo library AND the
                camera, instead of forcing the camera open. */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => upload(e.target.files)}
            />
          </>
        )}
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <ImageIcon className="size-3.5" />{title} {active.length > 0 && <span className="opacity-70">({active.length})</span>}
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t('ui.loading')}</p>
      ) : active.length === 0 && deleted.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('purchasing.photos.none')}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {active.map((p, i) => (
            <div key={p.id} className="group relative size-20 overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={p.original_name || 'item photo'}
                className="size-full cursor-pointer object-cover"
                onClick={() => setLightbox(i)}
                loading="lazy"
              />
              {canEdit && (
                <button
                  type="button"
                  aria-label={t('ui.delete')}
                  onClick={() => removePhoto(p)}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (deleted.length > 0 || showDeleted) && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowDeleted((v) => !v)} className="text-[11px] text-muted-foreground hover:underline">
            {showDeleted ? t('purchasing.photos.hideDeleted') : t('purchasing.photos.showDeleted')}
          </button>
          {showDeleted && deleted.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {deleted.map((p) => (
                <div key={p.id} className="relative size-20 overflow-hidden rounded-md border border-dashed opacity-60">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.original_name || 'deleted photo'} className="size-full object-cover grayscale" loading="lazy" />
                  <button
                    type="button"
                    aria-label={t('purchasing.photos.restore')}
                    onClick={() => restorePhoto(p)}
                    className="absolute inset-0 flex items-center justify-center bg-black/40 text-white"
                  >
                    <RotateCcw className="size-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {showDeleted && deleted.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">{t('purchasing.photos.noDeleted')}</p>
          )}
        </div>
      )}

      {lightbox !== null && activeUrls.length > 0 && (
        <Lightbox images={activeUrls} initialIndex={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  )
}
