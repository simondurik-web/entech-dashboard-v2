'use client'

import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, Plus, Loader2, History } from 'lucide-react'

interface AuditEntry {
  id: string
  action: string
  field_name: string | null
  old_value: string | null
  new_value: string | null
  performed_by_name: string | null
  created_at: string
}

export interface EditablePallet {
  id: string
  palletNumber: string | number
  weight: string | number
  length?: number | null
  width?: number | null
  height?: number | null
  partsPerPallet: string | number
  photos: string[]
  shipmentPhotos?: string[]
  workPaperPhotos?: string[]
  ifNumber?: string
  order_id?: string
  edited_by_name?: string
  edited_at?: string
}

type PhotoCategory = 'pallet' | 'shipment' | 'work_paper'

interface PalletEditModalProps {
  pallet: EditablePallet | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  userName: string
}

export function PalletEditModal({ pallet, open, onOpenChange, onSaved, userName }: PalletEditModalProps) {
  const [weight, setWeight] = useState('')
  const [length, setLength] = useState('')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [partsPerPallet, setPartsPerPallet] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [shipmentPhotos, setShipmentPhotos] = useState<string[]>([])
  const [workPaperPhotos, setWorkPaperPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [uploadingCategory, setUploadingCategory] = useState<PhotoCategory | null>(null)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [loadingAudit, setLoadingAudit] = useState(false)
  const palletFileRef = useRef<HTMLInputElement>(null)
  const shipmentFileRef = useRef<HTMLInputElement>(null)
  const workPaperFileRef = useRef<HTMLInputElement>(null)

  // Reset form when pallet changes
  const resetForm = () => {
    if (!pallet) return
    setWeight(String(pallet.weight || ''))
    setLength(String(pallet.length || ''))
    setWidth(String(pallet.width || ''))
    setHeight(String(pallet.height || ''))
    setPartsPerPallet(String(pallet.partsPerPallet || ''))
    setPhotos([...(pallet.photos || [])])
    setShipmentPhotos([...(pallet.shipmentPhotos || [])])
    setWorkPaperPhotos([...(pallet.workPaperPhotos || [])])
    setError(null)
    setShowAudit(false)
    // Fetch audit log
    setLoadingAudit(true)
    fetch(`/api/pallet-records/${pallet.id}/audit`)
      .then(r => r.json())
      .then(data => setAuditLog(Array.isArray(data) ? data : []))
      .catch(() => setAuditLog([]))
      .finally(() => setLoadingAudit(false))
  }

  // Auto-fill form whenever pallet changes or modal opens
  useEffect(() => {
    if (open && pallet) resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pallet?.id])

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen)
  }

  const handleSave = async () => {
    if (!pallet) return
    setSaving(true)
    setError(null)
    try {
      // Always send all field values (pre-filled from current data)
      const payload: Record<string, unknown> = { edited_by_name: userName }
      payload.weight = weight !== '' ? parseFloat(weight) : null
      payload.length = length !== '' ? parseFloat(length) : null
      payload.width = width !== '' ? parseFloat(width) : null
      payload.height = height !== '' ? parseFloat(height) : null
      payload.parts_per_pallet = partsPerPallet !== '' ? parseInt(partsPerPallet) : null

      const res = await fetch(`/api/pallet-records/${pallet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, category: PhotoCategory) => {
    if (!pallet || !e.target.files?.[0]) return
    setUploadingCategory(category)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', e.target.files[0])
      formData.append('uploaded_by_name', userName)
      formData.append('category', category)
      const res = await fetch(`/api/pallet-records/${pallet.id}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }
      const data = await res.json()
      if (category === 'pallet') setPhotos(data.photo_urls)
      else if (category === 'shipment') setShipmentPhotos(data.shipment_photo_urls)
      else if (category === 'work_paper') setWorkPaperPhotos(data.work_paper_photo_urls)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingCategory(null)
      const ref = category === 'pallet' ? palletFileRef : category === 'shipment' ? shipmentFileRef : workPaperFileRef
      if (ref.current) ref.current.value = ''
    }
  }

  const handlePhotoDelete = async (photoUrl: string, category: PhotoCategory) => {
    if (!pallet || !confirm('Delete this photo?')) return
    setDeletingPhoto(photoUrl)
    setError(null)
    try {
      const res = await fetch(`/api/pallet-records/${pallet.id}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: photoUrl, deleted_by_name: userName, category }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Delete failed')
      }
      const data = await res.json()
      const columnName = category === 'shipment' ? 'shipment_photo_urls' : category === 'work_paper' ? 'work_paper_photo_urls' : 'photo_urls'
      const updated = data[columnName] || []
      if (category === 'pallet') setPhotos(updated)
      else if (category === 'shipment') setShipmentPhotos(updated)
      else if (category === 'work_paper') setWorkPaperPhotos(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingPhoto(null)
    }
  }

  if (!pallet) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" />
            Edit Pallet #{pallet.palletNumber}
            {pallet.ifNumber && <span className="text-sm text-muted-foreground font-normal">• IF{pallet.ifNumber}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {/* Weight + Parts */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Weight (lbs)</label>
              <input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 1045"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Parts per Pallet</label>
              <input
                type="number"
                value={partsPerPallet}
                onChange={(e) => setPartsPerPallet(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 352"
              />
            </div>
          </div>

          {/* Dimensions */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Dimensions (inches)</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              <input
                type="number"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="L"
              />
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="W"
              />
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="H"
              />
            </div>
          </div>

          {/* Photo Sections */}
          {/* Pallet | Work Paper | Shipping photo sections */}
          {([
            { category: 'pallet' as PhotoCategory, label: '📦 Pallet Photos', photos: photos, ref: palletFileRef, borderCls: 'border-blue-500/20 bg-blue-500/5' },
            { category: 'work_paper' as PhotoCategory, label: '📄 Work Paper Photos', photos: workPaperPhotos, ref: workPaperFileRef, borderCls: 'border-amber-500/20 bg-amber-500/5' },
            { category: 'shipment' as PhotoCategory, label: '🚛 Shipping Photos', photos: shipmentPhotos, ref: shipmentFileRef, borderCls: 'border-green-500/20 bg-green-500/5' },
          ]).map(({ category, label, photos: catPhotos, ref, borderCls }) => (
            <div key={category} className={`rounded-lg border ${borderCls} p-2.5`}>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold">{label} ({catPhotos.length})</label>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => ref.current?.click()}
                  disabled={uploadingCategory === category}
                >
                  {uploadingCategory === category ? <Loader2 className="size-3 animate-spin mr-1" /> : <Plus className="size-3 mr-1" />}
                  Add
                </Button>
                <input
                  ref={ref}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handlePhotoUpload(e, category)}
                />
              </div>
              {catPhotos.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {catPhotos.map((url, i) => (
                    <div key={i} className="relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`${label} ${i + 1}`}
                        className="w-full h-16 object-cover rounded-md border"
                        loading="lazy"
                      />
                      <button
                        className="absolute top-0.5 right-0.5 bg-red-500/90 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handlePhotoDelete(url, category)}
                        disabled={deletingPhoto === url}
                        title="Delete photo"
                      >
                        {deletingPhoto === url ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground">No photos</p>
              )}
            </div>
          ))}

          {/* Audit trail */}
          <div>
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowAudit(!showAudit)}
            >
              <History className="size-3" />
              {showAudit ? 'Hide' : 'Show'} Change History
              {auditLog.length > 0 && <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{auditLog.length}</span>}
            </button>
            {showAudit && (
              <div className="mt-2 max-h-40 overflow-y-auto rounded-md border bg-muted/30">
                {loadingAudit ? (
                  <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="size-3 animate-spin" /> Loading...
                  </div>
                ) : auditLog.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">No changes recorded yet</p>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr className="border-b">
                        <th className="text-left px-2 py-1 font-medium">When</th>
                        <th className="text-left px-2 py-1 font-medium">Who</th>
                        <th className="text-left px-2 py-1 font-medium">What</th>
                        <th className="text-left px-2 py-1 font-medium">From</th>
                        <th className="text-left px-2 py-1 font-medium">To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLog.map((entry) => (
                        <tr key={entry.id} className={`border-b border-border/20 ${entry.action === 'deleted' ? 'bg-red-500/10' : entry.action === 'recovered' ? 'bg-green-500/10' : ''}`}>
                          <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">
                            {new Date(entry.created_at).toLocaleDateString()}{' '}
                            {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-2 py-1 font-medium">{entry.performed_by_name || '—'}</td>
                          <td className="px-2 py-1">
                            {entry.action === 'created' ? '🆕 Created' :
                             entry.action === 'deleted' ? '🗑️ Deleted' :
                             entry.action === 'recovered' ? '♻️ Recovered' :
                             entry.action === 'photo_added' ? '📷 Photo added' :
                             entry.action === 'photo_deleted' ? '🗑️ Photo removed' :
                             `✏️ ${entry.field_name}`}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">
                            {entry.action === 'deleted' ? 'Full record archived' : (entry.old_value || '—')}
                          </td>
                          <td className="px-2 py-1">
                            {entry.action === 'deleted' ? (
                              <button
                                className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-600 rounded hover:bg-green-500/30"
                                onClick={async () => {
                                  if (!pallet) return
                                  const res = await fetch(`/api/pallet-records/${pallet.id}/recover`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ recovered_by_name: userName }),
                                  })
                                  if (res.ok) {
                                    onSaved()
                                    onOpenChange(false)
                                  }
                                }}
                              >
                                ♻️ Recover
                              </button>
                            ) : (entry.new_value || '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : <Pencil className="size-4 mr-1" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
