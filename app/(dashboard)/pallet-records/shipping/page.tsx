'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useI18n } from '@/lib/i18n'
import { userHeaders } from '@/lib/quality/form-utils'
import { usePalletAccess } from '@/lib/use-pallet-access'

interface Order {
  id: string
  line_number: string
  if_number: string
  po_number: string
  customer: string
  order_qty: number
  num_pallets: number
  status: string
}

interface ShippingRecord {
  id: string
  order_id: string
  carrier: string | null
  system_type: string
  if_number: string | null
  shopify_orders: string | null
  veeqo_orders: string | null
  customer: string | null
  line_number: string | null
  shipment_photos: string[]
  paperwork_photos: string[]
  closeup_photos: string[]
  pallet_photos: string[]
  recorded_by: string
  recorded_by_name: string
  edited_by: string | null
  edited_by_name: string | null
  edited_at: string | null
  created_at: string
}

type SystemType = 'shopify' | 'other'
type View = 'list' | 'form' | 'edit-staged'

function isWithin3Days(dateStr: string): boolean {
  const created = new Date(dateStr).getTime()
  const threeDays = 3 * 24 * 60 * 60 * 1000
  return Date.now() - created < threeDays
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Compress image on client side before uploading — max 1200px, 0.7 quality JPEG */
async function compressImage(file: File, maxWidth = 1200, quality = 0.7): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      let w = img.width
      let h = img.height
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w)
        w = maxWidth
      }
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => resolve(blob || file),
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // fallback to original
    }
    img.src = url
  })
}

/** Upload with retry (up to 3 attempts) */
async function uploadWithRetry(formData: FormData, headers: HeadersInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('/api/pallet-records/upload', { method: 'POST', headers, body: formData })
      if (res.ok) return res
      if (attempt === retries) return res
    } catch (err) {
      if (attempt === retries) throw err
    }
    // Wait before retry (1s, 2s)
    await new Promise((r) => setTimeout(r, attempt * 1000))
  }
  throw new Error('Upload failed after retries')
}

export default function ShippingPage() {
  const { t: translate } = useI18n()
  const { profile, loading: authLoading } = useAuth()
  const { canSeePallets, isPalletAdmin } = usePalletAccess()
  const t = useCallback((key: string) => translate(`pallets.${key}`), [translate])
  const apiFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    return fetch(input, {
      ...init,
      headers: {
        ...userHeaders(profile?.id),
        ...(init.headers || {}),
      },
    })
  }, [profile?.id])
  const uploadHeaders = useCallback(() => ({ 'x-user-id': profile?.id || '' }), [profile?.id])
  const [orders, setOrders] = useState<Order[]>([])
  const [recentRecords, setRecentRecords] = useState<ShippingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('list')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [editingRecord, setEditingRecord] = useState<ShippingRecord | null>(null)
  const [userId, setUserId] = useState('')
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState<string>('user')

  // Form state
  const [carrier, setCarrier] = useState('')
  const [systemType, setSystemType] = useState<SystemType>('shopify')
  const [ifNumber, setIfNumber] = useState('')
  const [shopifyOrders, setShopifyOrders] = useState('')
  const [otherCustomer, setOtherCustomer] = useState('')
  const [otherOrderNumber, setOtherOrderNumber] = useState('')
  const [shipmentPhotos, setShipmentPhotos] = useState<string[]>([])
  const [paperworkPhotos, setPaperworkPhotos] = useState<string[]>([])
  const [closeupPhotos, setCloseupPhotos] = useState<string[]>([])
  const [palletPhotos, setPalletPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [savingPalletOnly, setSavingPalletOnly] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Edit staged order state (admin only)
  const [editStagedOrder, setEditStagedOrder] = useState<Order | null>(null)
  const [stagedPallets, setStagedPallets] = useState<{ id: string; pallet_number: number; weight: number | null; length: number | null; width: number | null; height: number | null; photo_urls: string[] }[]>([])
  const [stagedBulkEdits, setStagedBulkEdits] = useState<Record<string, { weight: string; length: string; width: string; height: string; photo_urls: string[] }>>({})
  const [stagedLoading, setStagedLoading] = useState(false)
  const [stagedSaving, setStagedSaving] = useState(false)

  const fetchOrders = useCallback(async () => {
    if (authLoading || !canSeePallets || !profile?.id) return
    setLoading(true)
    setError('')
    try {
      const [ordersRes, recordsRes] = await Promise.all([
        apiFetch('/api/pallet-records/shipping'),
        apiFetch('/api/pallet-records/shipping?mode=records'),
      ])
      if (!ordersRes.ok) throw new Error('Failed to fetch orders')
      const ordersData = await ordersRes.json()
      if (ordersData.error) throw new Error(ordersData.error)
      setOrders(ordersData)

      if (recordsRes.ok) {
        const recordsData = await recordsRes.json()
        if (Array.isArray(recordsData)) {
          // Show records from last 3 days for regular users, all for admin
          const filtered = userRole === 'admin'
            ? recordsData
            : recordsData.filter((r: ShippingRecord) => isWithin3Days(r.created_at))
          setRecentRecords(filtered)
        }
      }
    } catch {
      setError(t('ship.error'))
    } finally {
      setLoading(false)
    }
  }, [apiFetch, authLoading, canSeePallets, profile?.id, t, userRole])

  useEffect(() => {
    setUserId(profile?.id || '')
    setUserName(profile?.full_name || profile?.email?.split('@')[0] || '')
    setUserRole(isPalletAdmin ? 'admin' : 'user')
  }, [profile?.email, profile?.full_name, profile?.id, isPalletAdmin])

  useEffect(() => {
    if (authLoading) return
    if (!canSeePallets || !profile?.id) {
      setLoading(false)
      return
    }
    fetchOrders()
  }, [authLoading, canSeePallets, fetchOrders, profile?.id])

  const openForm = async (order?: Order) => {
    setSelectedOrder(order || null)
    setEditingRecord(null)
    setCarrier('')
    setSystemType('shopify')
    setIfNumber(order?.if_number || '')
    setShopifyOrders('')
    setOtherCustomer(order?.customer || '')
    setOtherOrderNumber('')
    setShipmentPhotos([])
    setPaperworkPhotos([])
    setCloseupPhotos([])
    setPalletPhotos([])
    setSuccessMsg('')
    setView('form')

    // If we're opening for a staged order, check for an existing draft
    // (record with pallet photos but no carrier yet — Option A pallet-photo flow)
    if (order?.if_number) {
      try {
        const res = await apiFetch(`/api/pallet-records/shipping?mode=records&if_number=${encodeURIComponent(order.if_number)}`)
        if (res.ok) {
          const records: ShippingRecord[] = await res.json()
          const draft = Array.isArray(records)
            ? records.find(r => (!r.carrier || !r.carrier.trim()) && r.if_number === order.if_number)
            : null
          if (draft) {
            openEditForm(draft)
          }
        }
      } catch {
        // Non-fatal — worker can still save as new
      }
    }
  }

  const openEditForm = (record: ShippingRecord) => {
    setSelectedOrder(null)
    setEditingRecord(record)
    setCarrier(record.carrier || '')
    // Map historical 'veeqo' records into the Shopify UI selector.
    // DB preserves the original system_type until saved; saving migrates it to 'shopify'.
    const uiSystem: SystemType = (record.system_type === 'veeqo' || record.system_type === 'shopify') ? 'shopify' : 'other'
    setSystemType(uiSystem)
    setIfNumber(record.if_number || '')
    // Prefer shopify_orders; fall back to veeqo_orders for historical records.
    setShopifyOrders(record.shopify_orders || record.veeqo_orders || '')
    setOtherCustomer(record.customer || '')
    setOtherOrderNumber(record.order_id || '')
    setShipmentPhotos((record.shipment_photos as unknown as string[]) || [])
    setPaperworkPhotos((record.paperwork_photos as unknown as string[]) || [])
    setCloseupPhotos((record.closeup_photos as unknown as string[]) || [])
    setPalletPhotos((record.pallet_photos as unknown as string[]) || [])
    setSuccessMsg('')
    setView('form')
  }

  const canEdit = (record: ShippingRecord): boolean => {
    if (userRole === 'admin') return true
    return record.recorded_by === userId && isWithin3Days(record.created_at)
  }

  const handlePhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    label: string
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      // Compress image before upload (iPhone photos can be 5-10MB)
      const compressed = await compressImage(file)
      const formData = new FormData()
      formData.append('file', compressed, `photo-${Date.now()}.jpg`)
      formData.append('if_number', ifNumber || otherOrderNumber || 'shipping')
      formData.append('pallet_number', 'shipment')

      const res = await uploadWithRetry(formData, uploadHeaders(), 3)
      const data = await res.json()
      if (res.ok && data.url) {
        setter(prev => [...prev, data.url])
      } else {
        console.error(`Failed to upload ${label}:`, data)
        alert(`Photo upload failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error(`Failed to upload ${label}:`, err)
      alert('Photo upload failed — check your connection and try again')
    }
    // Reset input so same file can be re-selected
    e.target.value = ''
    setUploading(false)
  }

  const buildSavePayload = (opts: { includeCarrier: boolean }) => {
    const customerValue = systemType === 'shopify'
      ? 'Origen RV Accessories'
      : (systemType === 'other' ? otherCustomer : (selectedOrder?.customer || ''))
    const orderIdValue = systemType === 'shopify'
      ? shopifyOrders
      : (systemType === 'other' ? otherOrderNumber : (selectedOrder?.if_number || ''))
    return {
      carrier: opts.includeCarrier ? carrier : '',
      system_type: systemType,
      // Always include if_number when a staged order context exists — this enables
      // draft detection (openForm looks up drafts by if_number) for the pallet-photo flow.
      if_number: selectedOrder?.if_number || ifNumber || '',
      shopify_orders: systemType === 'shopify' ? shopifyOrders : '',
      // Historical 'veeqo' records being edited migrate to 'shopify' — clear veeqo_orders.
      veeqo_orders: '',
      customer: customerValue,
      line_number: selectedOrder?.line_number || '',
      order_id: orderIdValue,
      shipment_photos: shipmentPhotos,
      paperwork_photos: paperworkPhotos,
      closeup_photos: closeupPhotos,
      pallet_photos: palletPhotos,
    }
  }

  const handleSave = async () => {
    if (!carrier) return
    setSaving(true)
    setSuccessMsg('')

    try {
      if (editingRecord) {
        const payload = {
          id: editingRecord.id,
          ...buildSavePayload({ includeCarrier: true }),
          edited_by: userId,
          edited_by_name: userName,
        }

        const res = await apiFetch('/api/pallet-records/shipping', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (res.status === 403) {
          const data = await res.json()
          setError(data.error || t('ship.noPermission'))
          setSaving(false)
          return
        }
        if (!res.ok) throw new Error('Failed')
        setSuccessMsg(t('ship.updated'))
      } else {
        const payload = {
          ...buildSavePayload({ includeCarrier: true }),
          recorded_by: userId,
          recorded_by_name: userName,
        }

        const res = await apiFetch('/api/pallet-records/shipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (!res.ok) throw new Error('Failed')
        setSuccessMsg(t('ship.success'))
      }

      setTimeout(() => {
        setView('list')
        setEditingRecord(null)
        fetchOrders()
      }, 2000)
    } catch {
      setError('Failed to save')
    }
    setSaving(false)
  }

  // Admin-only: delete a shipping record. Audit trail preserves old_data for restore
  // via Admin → Audit Trail → Restore button.
  const handleDeleteShipment = async (record: ShippingRecord) => {
    if (userRole !== 'admin') return
    const orderLabel = record.order_id || record.if_number || record.customer || record.id.slice(0, 8)
    if (!confirm(`Delete this shipping record (${orderLabel})?\n\nIt can be restored later from Admin → Audit Trail.`)) return

    setDeletingId(record.id)
    setError('')
    try {
      const params = new URLSearchParams({
        id: record.id,
        deleted_by: userId,
        deleted_by_name: userName,
      })
      const res = await apiFetch(`/api/pallet-records/shipping?${params.toString()}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(data.error || 'Failed to delete')
      }
      fetchOrders()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  // Save pallet photo only — creates a draft record (carrier empty) or updates an existing draft.
  // This is the Option A pallet-photo-first flow: worker submits pallet photo before shipment.
  const handleSavePalletPhoto = async () => {
    if (palletPhotos.length === 0) return
    setSavingPalletOnly(true)
    setSuccessMsg('')
    setError('')

    try {
      if (editingRecord) {
        // Update existing record's pallet_photos only
        const payload = {
          id: editingRecord.id,
          pallet_photos: palletPhotos,
          edited_by: userId,
          edited_by_name: userName,
        }
        const res = await apiFetch('/api/pallet-records/shipping', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed')
        setSuccessMsg(t('ship.palletPhotoSaved'))
      } else {
        // Create new draft record with pallet_photos, no carrier
        const payload = {
          ...buildSavePayload({ includeCarrier: false }),
          recorded_by: userId,
          recorded_by_name: userName,
        }
        const res = await apiFetch('/api/pallet-records/shipping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed')
        const created = await res.json()
        // Re-enter edit mode on the created draft so a subsequent save updates the same row
        if (created && created.id) {
          setEditingRecord(created as ShippingRecord)
        }
        setSuccessMsg(t('ship.palletPhotoSaved'))
      }

      fetchOrders()
    } catch {
      setError('Failed to save pallet photo')
    }
    setSavingPalletOnly(false)
  }

  const openEditStaged = async (order: Order) => {
    setEditStagedOrder(order)
    setSuccessMsg('')
    setError('')
    setView('edit-staged')
    setStagedLoading(true)
    try {
      const res = await apiFetch(`/api/pallet-records/pallets?line_number=${order.line_number}`)
      if (!res.ok) throw new Error('Failed to fetch pallets')
      const data = await res.json()
      setStagedPallets(data)
      const edits: Record<string, { weight: string; length: string; width: string; height: string; photo_urls: string[] }> = {}
      data.forEach((p: { id: string; weight: number | null; length: number | null; width: number | null; height: number | null; photo_urls: string[] }) => {
        edits[p.id] = {
          weight: p.weight?.toString() || '',
          length: p.length?.toString() || '',
          width: p.width?.toString() || '',
          height: p.height?.toString() || '',
          photo_urls: p.photo_urls || [],
        }
      })
      setStagedBulkEdits(edits)
    } catch {
      setError('Failed to load pallets')
    } finally {
      setStagedLoading(false)
    }
  }

  const handleStagedSave = async () => {
    if (!editStagedOrder) return
    setStagedSaving(true)
    setSuccessMsg('')
    setError('')
    try {
      const updates = Object.entries(stagedBulkEdits).map(([id, vals]) => ({
        id,
        weight: vals.weight ? parseFloat(vals.weight) : null,
        length: vals.length ? parseFloat(vals.length) : null,
        width: vals.width ? parseFloat(vals.width) : null,
        height: vals.height ? parseFloat(vals.height) : null,
        photo_urls: vals.photo_urls,
        edited_by: userId,
        edited_by_name: userName,
      }))
      const res = await apiFetch('/api/pallet-records/pallets/bulk-update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSuccessMsg('All pallets updated!')
      setTimeout(() => {
        setView('list')
        setEditStagedOrder(null)
        fetchOrders()
      }, 1500)
    } catch {
      setError('Failed to save pallet changes')
    } finally {
      setStagedSaving(false)
    }
  }

  const handleStagedPhotoUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    palletId: string,
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const compressed = await compressImage(file)
      const formData = new FormData()
      formData.append('file', compressed, `photo-${Date.now()}.jpg`)
      formData.append('if_number', editStagedOrder?.if_number || 'staged')
      formData.append('pallet_number', 'pallet')
      const res = await uploadWithRetry(formData, uploadHeaders(), 3)
      const data = await res.json()
      if (res.ok && data.url) {
        setStagedBulkEdits(prev => ({
          ...prev,
          [palletId]: {
            ...prev[palletId],
            photo_urls: [...(prev[palletId]?.photo_urls || []), data.url],
          },
        }))
      } else {
        alert(`Photo upload failed: ${data.error || 'Unknown error'}`)
      }
    } catch {
      alert('Photo upload failed — check your connection and try again')
    }
    e.target.value = ''
    setUploading(false)
  }

  const multiPhotoField = (
    label: string,
    photos: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    max: number = 5,
  ) => (
    <div>
      <label className="block text-sm font-medium text-muted-foreground mb-1">
        {label} {photos.length > 0 && <span className="text-muted-foreground font-normal">({photos.length}/{max})</span>}
      </label>
      {photos.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {photos.map((url, idx) => (
            <div key={idx} className="relative w-16 h-16">
              <div className="w-full h-full bg-green-50 border-2 border-green-300 rounded-lg flex items-center justify-center">
                <span className="text-green-600 text-xs">✅ {idx + 1}</span>
              </div>
              <button
                onClick={() => setter(prev => prev.filter((_, i) => i !== idx))}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length < max && (
        <label className="block w-full h-16 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-sky-400 active:bg-sky-50 dark:active:bg-sky-950">
          <div className="text-center">
            <span className="text-xl">📷</span>
            <p className="text-xs text-muted-foreground">{photos.length === 0 ? t('pallet.photo') : `+ Add (${photos.length}/${max})`}</p>
          </div>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handlePhotoUpload(e, setter, label)}
            disabled={uploading}
          />
        </label>
      )}
    </div>
  )

  // LIST VIEW
  if (view === 'list') {
    const q = searchQuery.trim().toLowerCase()
    const filteredOrders = q
      ? orders.filter(o =>
          (o.if_number || '').toLowerCase().includes(q) ||
          (o.po_number || '').toLowerCase().includes(q) ||
          (o.customer || '').toLowerCase().includes(q) ||
          (o.line_number || '').toLowerCase().includes(q)
        )
      : orders

    return (
      <div className="p-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl p-4 mb-4 shadow-lg">
          <h1 className="text-xl font-bold">{t('ship.title')}</h1>
          <p className="text-muted-foreground text-sm">{orders.length} {t('ship.staged').toLowerCase()}</p>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('ship.searchPlaceholder')}
            className="flex-1 border-2 border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
            aria-label={t('ship.searchPlaceholder')}
          />
          <button
            onClick={() => openForm()}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg font-medium text-sm whitespace-nowrap"
          >
            + {t('ship.submit')}
          </button>
        </div>

        {loading && <p className="text-center text-muted-foreground py-8">{t('ship.loading')}</p>}
        {error && (
          <div className="text-center py-8">
            <p className="text-red-500 mb-2">{error}</p>
            <button onClick={fetchOrders} className="px-4 py-2 bg-sky-600 text-white rounded-lg">{t('ship.retry')}</button>
          </div>
        )}
        {!loading && !error && orders.length === 0 && recentRecords.length === 0 && (
          <div className="text-center py-8 bg-card rounded-xl shadow-sm">
            <p className="text-muted-foreground">{t('ship.noOrders')}</p>
          </div>
        )}

        {!loading && !error && q && filteredOrders.length === 0 && orders.length > 0 && (
          <div className="text-center py-4 bg-card rounded-xl shadow-sm mb-3">
            <p className="text-muted-foreground text-sm">{t('prod.noResults')}</p>
          </div>
        )}

        {/* Staged Orders (shipped-needs-photos pinned on top by the API) */}
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const needsShipmentPhotos = order.status === 'shipped_needs_photos'
            return (
            <div
              key={order.id}
              className={`w-full text-left bg-card rounded-xl shadow-sm p-4 hover:shadow-md transition-all${
                needsShipmentPhotos ? ' ring-2 ring-red-400 dark:ring-red-500/60' : ''
              }`}
            >
              <div onClick={() => openForm(order)} className="cursor-pointer active:bg-muted">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-lg text-foreground">SO# {order.if_number}</p>
                    <p className="text-muted-foreground font-medium">{order.customer}</p>
                    <p className="text-muted-foreground text-sm">PO: {order.po_number} · Line: {order.line_number}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    needsShipmentPhotos ? 'bg-red-100 text-red-800' : 'bg-purple-100 text-purple-800'
                  }`}>
                    {needsShipmentPhotos ? t('ship.missingPhotos') : t('ship.staged')}
                  </span>
                </div>
                {needsShipmentPhotos && (
                  <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                    📷 {t('ship.missingPhotosHint')}
                  </p>
                )}
                <div className="mt-2 text-sm text-muted-foreground">
                  <span>{t('prod.qty')}: <strong>{order.order_qty}</strong></span>
                  <span className="ml-4">{t('prod.pallets')}: <strong>{order.num_pallets}</strong></span>
                </div>
              </div>
              {userRole === 'admin' && (
                <div className="mt-2 pt-2 border-t border-border flex justify-end">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditStaged(order) }}
                    className="px-3 py-1 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 active:bg-amber-300"
                  >
                    ✏️ Edit Pallets
                  </button>
                </div>
              )}
            </div>
            )
          })}
        </div>

        {/* Recent Shipping Records */}
        {recentRecords.length > 0 && (
          <div className="mt-6">
            <h2 className="text-lg font-bold text-foreground mb-3">{t('ship.recentShipments')}</h2>
            <div className="space-y-3">
              {recentRecords.map((record) => {
                const editable = canEdit(record)
                const hasPhotos = (record.shipment_photos?.length > 0) || (record.paperwork_photos?.length > 0) || (record.closeup_photos?.length > 0) || (record.pallet_photos?.length > 0)

                return (
                  <div
                    key={record.id}
                    className="bg-card rounded-xl shadow-sm p-4 transition-all"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-lg">{record.customer || '—'}</p>
                          {record.system_type === 'shopify' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Shopify</span>
                          )}
                          {record.system_type === 'veeqo' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">Veeqo</span>
                          )}
                          {record.system_type === 'other' && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">{t('ship.other')}</span>
                          )}
                          {!record.carrier && (record.pallet_photos?.length > 0) && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">📷 Pallet Photo</span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {record.carrier}
                          {record.order_id ? ` · ${record.order_id}` : ''}
                        </p>
                        <p className="text-muted-foreground text-xs mt-1">
                          {formatDate(record.created_at)} · {record.recorded_by_name}
                          {hasPhotos && ' · 📷'}
                          {record.edited_at && ` · ✏️ ${formatDate(record.edited_at)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                          ✅
                        </span>
                        {editable && (
                          <button
                            onClick={() => openEditForm(record)}
                            className="px-3 py-1 rounded-lg text-sm font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-200 active:bg-yellow-300"
                          >
                            {t('ship.edit')}
                          </button>
                        )}
                        {userRole === 'admin' && (
                          <button
                            onClick={() => handleDeleteShipment(record)}
                            disabled={deletingId === record.id}
                            className="px-3 py-1 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 active:bg-red-300 disabled:opacity-50"
                            title="Admin: delete shipping record (restorable from Audit Trail)"
                          >
                            {deletingId === record.id ? '...' : '🗑️'}
                          </button>
                        )}
                      </div>
                    </div>
                    {editable && !isWithin3Days(record.created_at) && userRole === 'admin' && (
                      <p className="text-xs text-orange-500 mt-1">Admin edit</p>
                    )}
                    {editable && isWithin3Days(record.created_at) && record.recorded_by === userId && userRole !== 'admin' && (
                      <p className="text-xs text-muted-foreground mt-1">{t('ship.editWindow')}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  // EDIT STAGED VIEW (admin bulk edit pallets)
  if (view === 'edit-staged' && editStagedOrder) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <button onClick={() => { setView('list'); setEditStagedOrder(null); setSuccessMsg(''); setError('') }} className="text-sky-600 dark:text-sky-400 mb-4 text-lg">
          ← {t('ship.back')}
        </button>

        <div className="bg-gradient-to-r from-amber-600 to-amber-500 text-white rounded-xl p-4 mb-4 shadow-lg">
          <h2 className="text-lg font-bold">✏️ Edit Pallets</h2>
          <p className="text-amber-100 text-sm">SO# {editStagedOrder.if_number} · {editStagedOrder.customer}</p>
          <p className="text-amber-100 text-sm">PO: {editStagedOrder.po_number} · Line: {editStagedOrder.line_number} · {stagedPallets.length} pallets</p>
        </div>

        {stagedLoading && <p className="text-center text-muted-foreground py-8">Loading pallets...</p>}
        {error && (
          <div className="text-center py-4">
            <p className="text-red-500 mb-2">{error}</p>
          </div>
        )}

        {!stagedLoading && stagedPallets.length > 0 && (
          <div className="space-y-4">
            {/* Apply to All */}
            <div className="p-3 bg-sky-50 dark:bg-sky-950 rounded-lg border border-blue-200">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-300 mb-2">Apply to all pallets:</p>
              <div className="grid grid-cols-[3rem_repeat(2,minmax(0,1fr))] sm:grid-cols-[3rem_repeat(4,minmax(0,1fr))] gap-2">
                <span></span>
                <input id="staged-bulk-weight" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="Weight" />
                <input id="staged-bulk-length" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="L" />
                <input id="staged-bulk-width" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground sm:col-auto col-start-2" placeholder="W" />
                <input id="staged-bulk-height" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="H" />
              </div>
              <button
                onClick={() => {
                  const w = (document.getElementById('staged-bulk-weight') as HTMLInputElement)?.value || ''
                  const l = (document.getElementById('staged-bulk-length') as HTMLInputElement)?.value || ''
                  const wd = (document.getElementById('staged-bulk-width') as HTMLInputElement)?.value || ''
                  const h = (document.getElementById('staged-bulk-height') as HTMLInputElement)?.value || ''
                  setStagedBulkEdits(prev => {
                    const updated: typeof prev = {}
                    stagedPallets.forEach(p => {
                      updated[p.id] = {
                        weight: w || prev[p.id]?.weight || '',
                        length: l || prev[p.id]?.length || '',
                        width: wd || prev[p.id]?.width || '',
                        height: h || prev[p.id]?.height || '',
                        photo_urls: prev[p.id]?.photo_urls || [],
                      }
                    })
                    return updated
                  })
                }}
                className="mt-2 px-3 py-1 bg-sky-600 text-white rounded text-sm font-medium active:bg-sky-700"
              >
                Apply to All
              </button>
            </div>

            {/* Column headers */}
            <div className="hidden sm:grid grid-cols-[3rem_repeat(4,minmax(0,1fr))] gap-2 text-xs font-medium text-muted-foreground px-2">
              <span>#</span>
              <span>Weight (lbs)</span>
              <span>Length</span>
              <span>Width</span>
              <span>Height</span>
            </div>

            {/* Per-pallet rows */}
            {stagedPallets.map((p) => (
              <div key={p.id} className="bg-card rounded-xl shadow-sm p-3 border border-border">
                <div className="grid grid-cols-[3rem_repeat(2,minmax(0,1fr))] sm:grid-cols-[3rem_repeat(4,minmax(0,1fr))] gap-2">
                  <span className="flex items-center font-semibold text-sm text-foreground">#{p.pallet_number}</span>
                  <input
                    type="number"
                    value={stagedBulkEdits[p.id]?.weight || ''}
                    onChange={e => setStagedBulkEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], weight: e.target.value } }))}
                    className="border rounded px-2 py-1 text-sm w-full text-foreground sm:col-auto col-start-2"
                    placeholder="lbs"
                  />
                  <input
                    type="number"
                    value={stagedBulkEdits[p.id]?.length || ''}
                    onChange={e => setStagedBulkEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], length: e.target.value } }))}
                    className="border rounded px-2 py-1 text-sm w-full text-foreground"
                    placeholder="L"
                  />
                  <input
                    type="number"
                    value={stagedBulkEdits[p.id]?.width || ''}
                    onChange={e => setStagedBulkEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], width: e.target.value } }))}
                    className="border rounded px-2 py-1 text-sm w-full text-foreground"
                    placeholder="W"
                  />
                  <input
                    type="number"
                    value={stagedBulkEdits[p.id]?.height || ''}
                    onChange={e => setStagedBulkEdits(prev => ({ ...prev, [p.id]: { ...prev[p.id], height: e.target.value } }))}
                    className="border rounded px-2 py-1 text-sm w-full text-foreground"
                    placeholder="H"
                  />
                </div>

                {/* Photos for this pallet */}
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Photos ({(stagedBulkEdits[p.id]?.photo_urls || []).length}/5)</p>
                  {(stagedBulkEdits[p.id]?.photo_urls || []).length > 0 && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                      {(stagedBulkEdits[p.id]?.photo_urls || []).map((url, idx) => (
                        <div key={idx} className="relative w-16 h-16">
                          <div className="w-full h-full bg-green-50 border-2 border-green-300 rounded-lg flex items-center justify-center">
                            <span className="text-green-600 text-xs">✅ {idx + 1}</span>
                          </div>
                          <button
                            onClick={() => setStagedBulkEdits(prev => ({
                              ...prev,
                              [p.id]: {
                                ...prev[p.id],
                                photo_urls: prev[p.id].photo_urls.filter((_, i) => i !== idx),
                              },
                            }))}
                            className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(stagedBulkEdits[p.id]?.photo_urls || []).length < 5 && (
                    <label className="block w-full h-12 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-sky-400 active:bg-sky-50 dark:active:bg-sky-950">
                      <div className="text-center">
                        <span className="text-lg">📷</span>
                        <span className="text-xs text-muted-foreground ml-1">+ Add photo</span>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleStagedPhotoUpload(e, p.id)}
                        disabled={uploading}
                      />
                    </label>
                  )}
                </div>
              </div>
            ))}

            {uploading && (
              <p className="text-center text-blue-500 text-sm">Uploading photo...</p>
            )}

            {/* Save All */}
            <button
              onClick={handleStagedSave}
              disabled={stagedSaving || uploading}
              className="w-full py-4 bg-emerald-600 text-white rounded-xl font-bold text-lg active:bg-emerald-700 disabled:opacity-50"
            >
              {stagedSaving ? 'Saving...' : `💾 Save All (${stagedPallets.length} pallets)`}
            </button>

            {successMsg && (
              <p className="text-center text-green-600 font-medium">✅ {successMsg}</p>
            )}
            {error && (
              <p className="text-center text-red-500 font-medium">❌ {error}</p>
            )}
          </div>
        )}

        {!stagedLoading && stagedPallets.length === 0 && !error && (
          <div className="text-center py-8 bg-card rounded-xl shadow-sm">
            <p className="text-muted-foreground">No pallets found for this order.</p>
          </div>
        )}
      </div>
    )
  }

  // SHIPPING FORM VIEW
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <button onClick={() => { setView('list'); setSuccessMsg(''); setEditingRecord(null) }} className="text-sky-600 dark:text-sky-400 mb-4 text-lg">
        {t('ship.back')}
      </button>

      <h2 className="text-xl font-bold mb-4">
        {editingRecord ? t('ship.update') : t('ship.submit')}
      </h2>

      <div className="bg-card rounded-xl shadow-sm p-4 space-y-4">
        {/* Editing indicator */}
        {editingRecord && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
            <p className="font-medium text-yellow-800">✏️ {t('ship.edit')}</p>
            <p className="text-yellow-600 text-xs">{formatDate(editingRecord.created_at)} · {editingRecord.recorded_by_name}</p>
          </div>
        )}

        {/* Selected order context */}
        {selectedOrder && (
          <div className="bg-muted rounded-lg p-3 text-sm">
            <p><strong>SO# {selectedOrder.if_number}</strong> · {selectedOrder.customer}</p>
            <p className="text-muted-foreground">PO: {selectedOrder.po_number} · Line: {selectedOrder.line_number}</p>
          </div>
        )}

        {/* Pallet Photo — submitted before shipment, does not require carrier */}
        <div className="border-2 border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <label className="block text-sm font-semibold text-amber-900">📷 {t('ship.palletPhoto')}</label>
            {palletPhotos.length > 0 && (
              <span className="text-xs text-amber-700">{palletPhotos.length} saved</span>
            )}
          </div>
          <p className="text-xs text-amber-700">{t('ship.palletPhotoHelp')}</p>
          {multiPhotoField(t('ship.palletPhoto'), palletPhotos, setPalletPhotos, 5)}
          <button
            onClick={handleSavePalletPhoto}
            disabled={savingPalletOnly || uploading || palletPhotos.length === 0}
            className="w-full py-3 bg-amber-600 text-white rounded-lg font-semibold text-base active:bg-amber-700 disabled:opacity-50"
          >
            {savingPalletOnly ? t('ship.saving') : `📷 ${t('ship.savePalletPhoto')}`}
          </button>
        </div>

        {/* Carrier */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">{t('ship.carrier')} *</label>
          <input
            type="text"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="XPO, Saia, UPS, FedEx..."
            className="w-full border-2 border-border rounded-lg p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
          />
        </div>

        {/* System type */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-2">{t('ship.system')} *</label>
          <div className="grid grid-cols-2 gap-2">
            {(['shopify', 'other'] as SystemType[]).map((sys) => (
              <button
                key={sys}
                onClick={() => setSystemType(sys)}
                className={`py-3 rounded-lg font-medium text-sm border-2 transition-all ${
                  systemType === sys
                    ? 'border-sky-600 dark:border-sky-400 bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300'
                    : 'border-border text-muted-foreground hover:border-gray-300'
                }`}
              >
                {sys === 'shopify' ? t('ship.shopify') : t('ship.other')}
              </button>
            ))}
          </div>
        </div>

        {/* System-specific fields */}
        {systemType === 'shopify' && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">{t('ship.customer')}</label>
              <div className="w-full border-2 border-border bg-muted rounded-lg p-3 text-lg text-muted-foreground">
                Origen RV Accessories
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">{t('ship.orderNumber')} *</label>
              <input
                type="text"
                value={shopifyOrders}
                onChange={(e) => setShopifyOrders(e.target.value)}
                placeholder="B2B-12345"
                className="w-full border-2 border-border rounded-lg p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {systemType === 'other' && (
          <>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">{t('ship.customer')} *</label>
              <input
                type="text"
                value={otherCustomer}
                onChange={(e) => setOtherCustomer(e.target.value)}
                className="w-full border-2 border-border rounded-lg p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">{t('ship.orderNumbers')} *</label>
              <input
                type="text"
                value={otherOrderNumber}
                onChange={(e) => setOtherOrderNumber(e.target.value)}
                className="w-full border-2 border-border rounded-lg p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
              />
            </div>
          </>
        )}

        {/* Photos */}
        <div className="space-y-3">
          {multiPhotoField(t('ship.shipmentPhoto'), shipmentPhotos, setShipmentPhotos)}
          {multiPhotoField(t('ship.paperworkPhoto'), paperworkPhotos, setPaperworkPhotos)}
          {multiPhotoField(t('ship.closeupPhoto'), closeupPhotos, setCloseupPhotos)}
        </div>

        {uploading && (
          <p className="text-center text-blue-500 text-sm">{t('pallet.uploading')}</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || uploading || !carrier}
          className={`w-full py-4 text-white rounded-lg font-bold text-lg active:opacity-80 disabled:opacity-50 ${
            editingRecord ? 'bg-yellow-600' : 'bg-sky-600'
          }`}
        >
          {saving
            ? t('ship.saving')
            : editingRecord
              ? t('ship.update')
              : t('ship.submit')
          }
        </button>

        {successMsg && (
          <p className="text-center text-green-600 font-medium">✅ {successMsg}</p>
        )}
        {error && view === 'form' && (
          <p className="text-center text-red-500 font-medium">❌ {error}</p>
        )}
      </div>
    </div>
  )
}
