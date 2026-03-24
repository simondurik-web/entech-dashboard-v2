'use client'

import { useState, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Pencil, Trash2, Plus, Loader2 } from 'lucide-react'

export interface EditablePallet {
  id: string
  palletNumber: string | number
  weight: string | number
  length?: number | null
  width?: number | null
  height?: number | null
  partsPerPallet: string | number
  photos: string[]
  ifNumber?: string
  order_id?: string
  edited_by_name?: string
  edited_at?: string
}

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
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset form when pallet changes
  const resetForm = () => {
    if (!pallet) return
    setWeight(String(pallet.weight || ''))
    setLength(String(pallet.length || ''))
    setWidth(String(pallet.width || ''))
    setHeight(String(pallet.height || ''))
    setPartsPerPallet(String(pallet.partsPerPallet || ''))
    setPhotos([...(pallet.photos || [])])
    setError(null)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) resetForm()
    onOpenChange(isOpen)
  }

  const handleSave = async () => {
    if (!pallet) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pallet-records/${pallet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: weight ? parseFloat(weight) : null,
          length: length ? parseFloat(length) : null,
          width: width ? parseFloat(width) : null,
          height: height ? parseFloat(height) : null,
          parts_per_pallet: partsPerPallet ? parseInt(partsPerPallet) : null,
          edited_by_name: userName,
        }),
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

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!pallet || !e.target.files?.[0]) return
    setUploadingPhoto(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', e.target.files[0])
      const res = await fetch(`/api/pallet-records/${pallet.id}/photos`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Upload failed')
      }
      const data = await res.json()
      setPhotos(data.photo_urls)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingPhoto(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePhotoDelete = async (photoUrl: string) => {
    if (!pallet || !confirm('Delete this photo?')) return
    setDeletingPhoto(photoUrl)
    setError(null)
    try {
      const res = await fetch(`/api/pallet-records/${pallet.id}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_url: photoUrl }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Delete failed')
      }
      const data = await res.json()
      setPhotos(data.photo_urls)
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

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Photos ({photos.length})</label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingPhoto}
              >
                {uploadingPhoto ? <Loader2 className="size-3 animate-spin mr-1" /> : <Plus className="size-3 mr-1" />}
                Add Photo
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
            </div>
            {photos.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((url, i) => (
                  <div key={i} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Pallet photo ${i + 1}`}
                      className="w-full h-20 object-cover rounded-md border"
                      loading="lazy"
                    />
                    <button
                      className="absolute top-1 right-1 bg-red-500/90 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handlePhotoDelete(url)}
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
              <p className="text-xs text-muted-foreground">No photos</p>
            )}
          </div>

          {/* Audit info */}
          {pallet.edited_by_name && (
            <p className="text-xs text-muted-foreground">
              Last edited by <span className="font-medium">{pallet.edited_by_name}</span>
              {pallet.edited_at && <> on {new Date(pallet.edited_at).toLocaleString()}</>}
            </p>
          )}
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
