'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useI18n } from '@/lib/i18n'
import { userHeaders } from '@/lib/quality/form-utils'
import { usePalletAccess } from '@/lib/use-pallet-access'

interface Order {
  id: string
  line_number: string
  category: string
  if_number: string
  po_number: string
  customer: string
  part_number: string
  order_qty: number
  num_pallets: number
  status: string
}

interface PalletRecord {
  id: string
  line_number: string
  pallet_number: number
  weight: number | null
  parts_per_pallet: number | null
  length: number | null
  width: number | null
  height: number | null
  photo_urls: string[]
  recorded_by: string
  recorded_by_name: string
  edited_by_name: string | null
  edited_at: string | null
  created_at: string
}

type View = 'list' | 'detail' | 'pallet-form'
type Tab = 'active' | 'completed'

export default function ProductionPage() {
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
  const [orders, setOrders] = useState<Order[]>([])
  const [completedOrders, setCompletedOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [completedLoading, setCompletedLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('list')
  const [activeTab, setActiveTab] = useState<Tab>('active')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [pallets, setPallets] = useState<PalletRecord[]>([])
  const [palletsLoading, setPalletsLoading] = useState(false)
  const [editingPallet, setEditingPallet] = useState<PalletRecord | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [palletCounts, setPalletCounts] = useState<Record<string, number>>({})

  // User info
  const [userId, setUserId] = useState('')
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')

  // Bulk edit state (admin only)
  const [bulkEditMode, setBulkEditMode] = useState(false)
  const [bulkEdits, setBulkEdits] = useState<Record<string, { weight: string; length: string; width: string; height: string }>>({})
  const [bulkSaving, setBulkSaving] = useState(false)

  // Form state
  const [palletNumber, setPalletNumber] = useState(1)
  const [weight, setWeight] = useState('')
  const [partsPerPallet, setPartsPerPallet] = useState('')
  const [lengthVal, setLengthVal] = useState('')
  const [widthVal, setWidthVal] = useState('')
  const [heightVal, setHeightVal] = useState('')
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [startingOrder, setStartingOrder] = useState(false)
  const realPallets = useMemo(() => pallets.filter((p) => p.pallet_number !== 0), [pallets])

  const fetchPalletCounts = useCallback(async (orderList: Order[]) => {
    if (authLoading || !canSeePallets || !profile?.id) return
    if (orderList.length === 0) return
    const lineNumbers = orderList.map(o => o.line_number).join(',')
    try {
      const res = await apiFetch(`/api/pallet-records/pallets/counts?line_numbers=${lineNumbers}`)
      if (res.ok) {
        const counts = await res.json()
        setPalletCounts(prev => ({ ...prev, ...counts }))
      }
    } catch { /* ignore */ }
  }, [apiFetch, authLoading, canSeePallets, profile?.id])

  const fetchOrders = useCallback(async () => {
    if (authLoading || !canSeePallets || !profile?.id) return
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/api/pallet-records/orders')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setOrders(data)
      fetchPalletCounts(data)
    } catch {
      setError(t('prod.error'))
    } finally {
      setLoading(false)
    }
  }, [apiFetch, authLoading, canSeePallets, profile?.id, t, fetchPalletCounts])

  const fetchCompletedOrders = useCallback(async () => {
    if (authLoading || !canSeePallets || !profile?.id) return
    setCompletedLoading(true)
    try {
      const res = await apiFetch('/api/pallet-records/orders?include_completed=true')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const completed = data.filter((o: Order) => o.status === 'completed')
      setCompletedOrders(completed)
      fetchPalletCounts(completed)
    } catch {
      setError(t('prod.error'))
    } finally {
      setCompletedLoading(false)
    }
  }, [apiFetch, authLoading, canSeePallets, profile?.id, t, fetchPalletCounts])

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

  // Handle QR scan deep-link: check localStorage for scan_context (survives OAuth redirects)
  useEffect(() => {
    if (orders.length === 0 || view !== 'list') return
    const raw = localStorage.getItem('scan_context')
    if (!raw) return
    localStorage.removeItem('scan_context')
    try {
      const scan = JSON.parse(raw)
      const order = orders.find(o => o.line_number === scan.line_number)
      if (order) {
        setSelectedOrder(order)
        setView('detail')
        setSuccessMsg('')
        // Fetch pallets
        apiFetch(`/api/pallet-records/pallets?line_number=${order.line_number}`)
          .then(r => r.ok ? r.json() : [])
          .then(data => {
            if (Array.isArray(data)) {
              setPallets(data)
              // If order is Pending with no real pallets, stay on detail page
              // so the worker sees the "Start Order" button first
              const realPallets = data.filter((p: PalletRecord) => p.pallet_number !== 0)
              if (order.status === 'pending' && realPallets.length === 0) {
                // Stay on order detail — worker will tap "Start Order"
                return
              }
              // Order is already started — auto-open pallet form with the scanned pallet number
              if (scan.pallet_number) {
                const existing = data.find((p: PalletRecord) => p.pallet_number === scan.pallet_number)
                if (existing) {
                  // Edit existing pallet
                  setEditingPallet(existing)
                  setPalletNumber(existing.pallet_number)
                  setWeight(existing.weight?.toString() || '')
                  setPartsPerPallet(existing.parts_per_pallet?.toString() || '')
                  setLengthVal(existing.length?.toString() || '')
                  setWidthVal(existing.width?.toString() || '')
                  setHeightVal(existing.height?.toString() || '')
                  setPhotoUrls(existing.photo_urls || [])
                } else {
                  // New pallet with pre-set number
                  setEditingPallet(null)
                  setPalletNumber(scan.pallet_number)
                  setPhotoUrls([])
                  // Pre-fill from last pallet if available
                  if (realPallets.length > 0) {
                    const last = realPallets[realPallets.length - 1]
                    setWeight(last.weight?.toString() || '')
                    setPartsPerPallet(last.parts_per_pallet?.toString() || '')
                    setLengthVal(last.length?.toString() || '')
                    setWidthVal(last.width?.toString() || '')
                    setHeightVal(last.height?.toString() || '')
                  } else {
                    setWeight('')
                    setPartsPerPallet('')
                    setLengthVal('')
                    setWidthVal('')
                    setHeightVal('')
                  }
                }
                setPrefilled(true)
                setView('pallet-form')
              }
            }
          })
      }
    } catch { /* ignore bad scan data */ }
  }, [apiFetch, orders, view])

  // Filtered orders based on search and active tab
  const currentOrders = activeTab === 'active' ? orders : completedOrders
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return currentOrders
    const q = searchQuery.toLowerCase()
    return currentOrders.filter(o =>
      o.if_number.toLowerCase().includes(q) ||
      o.po_number.toLowerCase().includes(q) ||
      o.customer.toLowerCase().includes(q) ||
      o.line_number.toLowerCase().includes(q) ||
      o.part_number.toLowerCase().includes(q)
    )
  }, [currentOrders, searchQuery])

  const fetchPallets = useCallback(async (lineNumber: string) => {
    setPalletsLoading(true)
    setPallets([])
    try {
      const res = await apiFetch(`/api/pallet-records/pallets?line_number=${lineNumber}`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) setPallets(data)
      }
    } catch { /* ignore */ }
    setPalletsLoading(false)
  }, [apiFetch])

  const openOrderDetail = (order: Order) => {
    setSelectedOrder(order)
    setView('detail')
    setSuccessMsg('')
    setPallets([])
    fetchPallets(order.line_number)
  }

  const openPalletForm = (pallet?: PalletRecord) => {
    if (pallet) {
      // Edit mode
      setEditingPallet(pallet)
      setPalletNumber(pallet.pallet_number)
      setWeight(pallet.weight?.toString() || '')
      setPartsPerPallet(pallet.parts_per_pallet?.toString() || '')
      setLengthVal(pallet.length?.toString() || '')
      setWidthVal(pallet.width?.toString() || '')
      setHeightVal(pallet.height?.toString() || '')
      setPhotoUrls(pallet.photo_urls || [])
      setPrefilled(false)
    } else {
      // New pallet — auto-increment and pre-fill from previous
      setEditingPallet(null)
      const nextNumber = Math.max(0, ...realPallets.map(p => p.pallet_number)) + 1
      setPalletNumber(nextNumber)
      setPhotoUrls([])
      setPrefilled(false)

      if (realPallets.length > 0) {
        // Pre-fill from last pallet
        const lastPallet = realPallets[realPallets.length - 1]
        setWeight(lastPallet.weight?.toString() || '')
        setPartsPerPallet(lastPallet.parts_per_pallet?.toString() || '')
        setLengthVal(lastPallet.length?.toString() || '')
        setWidthVal(lastPallet.width?.toString() || '')
        setHeightVal(lastPallet.height?.toString() || '')
        setPrefilled(true)
      } else {
        setWeight('')
        setPartsPerPallet('')
        setLengthVal('')
        setWidthVal('')
        setHeightVal('')
      }
    }
    setSuccessMsg('')
    setView('pallet-form')
  }

  const compressImage = (file: File, maxSizeMB = 3): Promise<File> => {
    return new Promise((resolve) => {
      // If already small enough, skip compression
      if (file.size <= maxSizeMB * 1024 * 1024) {
        resolve(file)
        return
      }
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        // Scale down if very large
        let { width, height } = img
        const MAX_DIM = 2048
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
            } else {
              resolve(file)
            }
          },
          'image/jpeg',
          0.8
        )
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(file) // fallback to original
      }
      img.src = url
    })
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const file = e.target.files?.[0]
    if (!file || !selectedOrder) return

    setUploading(true)
    setUploadError('')
    try {
      // Compress image for faster upload
      const compressed = await compressImage(file)
      console.log(`Photo: ${(file.size/1024/1024).toFixed(1)}MB → ${(compressed.size/1024/1024).toFixed(1)}MB`)

      // Step 1: Get a signed upload URL from our API (tiny JSON request — no size limit issue)
      const urlRes = await apiFetch('/api/pallet-records/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          if_number: selectedOrder.if_number,
          pallet_number: palletNumber.toString(),
          content_type: compressed.type || 'image/jpeg',
        }),
      })
      const urlData = await urlRes.json()
      if (!urlRes.ok) {
        console.error('Failed to get upload URL:', urlData)
        setUploadError(urlData.error || 'Failed to prepare upload')
        setUploading(false)
        return
      }

      // Step 2: Upload directly to Supabase Storage (bypasses Vercel's 4.5MB limit)
      const uploadRes = await fetch(urlData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': compressed.type || 'image/jpeg' },
        body: compressed,
      })

      if (uploadRes.ok) {
        const newPhotos = [...photoUrls]
        newPhotos[index] = urlData.publicUrl
        setPhotoUrls(newPhotos)
      } else {
        const errText = await uploadRes.text()
        console.error('Direct upload failed:', uploadRes.status, errText)
        setUploadError('Upload failed — try again')
      }
    } catch (err) {
      console.error('Upload error:', err)
      setUploadError('Network error — check connection and try again')
    }
    setUploading(false)
  }

  const savingRef = useRef(false)
  const handleSavePallet = async () => {
    if (!selectedOrder || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSuccessMsg('')

    try {
      const payload = {
        line_number: selectedOrder.line_number,
        pallet_number: palletNumber,
        weight: weight ? parseFloat(weight) : null,
        parts_per_pallet: partsPerPallet ? parseInt(partsPerPallet) : null,
        length: lengthVal ? parseFloat(lengthVal) : null,
        width: widthVal ? parseFloat(widthVal) : null,
        height: heightVal ? parseFloat(heightVal) : null,
        photo_urls: photoUrls.filter(Boolean),
      }

      if (editingPallet) {
        const res = await apiFetch('/api/pallet-records/pallets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            id: editingPallet.id,
            edited_by: userId,
            edited_by_name: userName,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        setSuccessMsg(t('pallet.updated'))
      } else {
        const res = await apiFetch('/api/pallet-records/pallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            recorded_by: userId,
            recorded_by_name: userName,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        setSuccessMsg(t('pallet.success'))
      }

      await fetchPallets(selectedOrder.line_number)
      setTimeout(() => {
        setView('detail')
        setSuccessMsg('')
      }, 1500)
    } catch {
      setError('Failed to save')
    }
    setSaving(false)
    savingRef.current = false
  }

  const handleDeletePallet = async (palletId: string) => {
    if (!selectedOrder) return
    if (!confirm('Delete this pallet record? This action will be logged in the audit trail.')) return

    try {
      const params = new URLSearchParams({
        id: palletId,
        deleted_by: userId,
        deleted_by_name: userName,
      })
      const res = await apiFetch(`/api/pallet-records/pallets?${params}`, { method: 'DELETE' })
      if (res.ok) {
        await fetchPallets(selectedOrder.line_number)
        setSuccessMsg('Pallet deleted')
        setTimeout(() => setSuccessMsg(''), 2000)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to delete')
      }
    } catch {
      setError('Network error')
    }
  }

  const progressPercent = (recorded: number, total: number) => {
    if (!total) return 0
    return Math.min(Math.round((recorded / total) * 100), 100)
  }

  const startOrder = async () => {
    if (!selectedOrder || startingOrder) return
    setStartingOrder(true)
    try {
      const res = await apiFetch('/api/pallet-records/orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          line_number: selectedOrder.line_number,
          recorded_by: userId,
          recorded_by_name: userName,
        }),
      })
      if (!res.ok) throw new Error('Failed to start order')
      // Update local state to reflect WIP status
      setSelectedOrder({ ...selectedOrder, status: 'wip' })
      setOrders(prev => prev.map(o =>
        o.line_number === selectedOrder.line_number ? { ...o, status: 'wip' } : o
      ))
    } catch (err) {
      console.error('Start order error:', err)
      setError(t('prod.error'))
    } finally {
      setStartingOrder(false)
    }
  }

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-amber-100 text-amber-800 border border-amber-200',
      wip: 'bg-sky-100 dark:bg-sky-950 text-blue-800 dark:text-sky-300 border border-blue-200',
      completed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    }
    const labels: Record<string, string> = {
      pending: t('prod.pending'),
      wip: t('prod.wip'),
      completed: t('prod.completed'),
    }
    return (
      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${colors[status] || 'bg-muted text-foreground'}`}>
        {labels[status] || status}
      </span>
    )
  }

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    setSearchQuery('')
    if (tab === 'completed' && completedOrders.length === 0) {
      fetchCompletedOrders()
    }
  }

  const palletCountBadge = (order: Order) => {
    const recorded = palletCounts[order.line_number] ?? -1
    if (recorded === -1) return null
    const total = order.num_pallets
    const color = recorded >= total && total > 0
      ? 'text-emerald-700'
      : recorded > 0
        ? 'text-amber-700'
        : 'text-muted-foreground'
    return (
      <span className={`text-sm font-semibold ${color}`}>
        {t('prod.pallets')}: {recorded}/{total}
      </span>
    )
  }

  const incompleteBadge = (order: Order) => {
    const recorded = palletCounts[order.line_number] ?? -1
    if (recorded === -1 || order.num_pallets === 0) return null
    if (recorded < order.num_pallets) {
      return (
        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
          ⚠️ {t('prod.incomplete')} — {recorded}/{order.num_pallets}
        </span>
      )
    }
    return null
  }

  // ==================== ORDER LIST ====================
  if (view === 'list') {
    const isLoading = activeTab === 'active' ? loading : completedLoading
    return (
      <div className="p-4 max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-700 text-white rounded-xl p-4 mb-4 shadow-lg">
          <h1 className="text-xl font-bold">{t('prod.title')}</h1>
          <p className="text-muted-foreground text-sm">{currentOrders.length} {t('prod.orders') || 'orders'}</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-4 bg-muted rounded-xl p-1">
          <button
            onClick={() => handleTabChange('active')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'active'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-muted-foreground'
            }`}
          >
            {t('prod.activeOrders')}
          </button>
          <button
            onClick={() => handleTabChange('completed')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              activeTab === 'completed'
                ? 'bg-card text-emerald-700 shadow-sm'
                : 'text-muted-foreground hover:text-muted-foreground'
            }`}
          >
            {t('prod.completedOrders')}
          </button>
        </div>

        {/* Search bar */}
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('prod.search') || '🔍 Search IF#, PO#, customer, line#, part#...'}
            className="w-full border-2 border-border rounded-xl p-3 text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none bg-card shadow-sm"
          />
        </div>

        {isLoading && <p className="text-center text-muted-foreground py-8">{t('prod.loading')}</p>}
        {error && (
          <div className="text-center py-8">
            <p className="text-red-600 mb-2">{error}</p>
            <button onClick={activeTab === 'active' ? fetchOrders : fetchCompletedOrders} className="px-4 py-2 bg-sky-600 text-white rounded-lg">{t('prod.retry')}</button>
          </div>
        )}
        {!isLoading && !error && filteredOrders.length === 0 && (
          <div className="text-center py-8 bg-card rounded-xl shadow-sm">
            <p className="text-muted-foreground">{searchQuery ? (t('prod.noResults') || 'No results found') : t('prod.noOrders')}</p>
          </div>
        )}

        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <button
              key={order.id}
              onClick={() => openOrderDetail(order)}
              className={`w-full text-left bg-card rounded-xl shadow-sm p-4 hover:shadow-md active:bg-muted transition-all ${
                order.status === 'completed'
                  ? 'border-2 border-emerald-200'
                  : 'border border-border'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-bold text-base text-foreground">IF# {order.if_number}</p>
                    {statusBadge(order.status)}
                  </div>
                  <p className="text-muted-foreground font-medium">{order.customer}</p>
                  <p className="text-muted-foreground text-sm">PO: {order.po_number}</p>
                  <div className="flex gap-3 text-sm text-muted-foreground mt-1">
                    <span>Line: <strong className="text-muted-foreground">{order.line_number}</strong></span>
                    {order.part_number && <span>Part: <strong className="text-muted-foreground">{order.part_number}</strong></span>}
                  </div>
                  {order.status === 'completed' && incompleteBadge(order)}
                </div>
              </div>
              <div className="flex gap-4 text-sm text-muted-foreground mt-2 pt-2 border-t border-border">
                <span>{t('prod.qty')}: <strong className="text-foreground">{order.order_qty}</strong></span>
                {palletCountBadge(order) || (
                  <span>{t('prod.pallets')}: <strong className="text-foreground">{order.num_pallets}</strong></span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ==================== ORDER DETAIL ====================
  if (view === 'detail' && selectedOrder) {
    const recorded = realPallets.length
    const total = selectedOrder.num_pallets
    const pct = progressPercent(recorded, total)

    return (
      <div className="p-4 max-w-2xl mx-auto">
        <button onClick={() => { setView('list'); setSelectedOrder(null) }} className="text-sky-600 dark:text-sky-400 font-medium mb-4 text-base">
          {t('prod.back')}
        </button>

        {/* Order info card */}
        <div className={`bg-card rounded-xl shadow-sm p-4 mb-4 ${selectedOrder.status === 'completed' ? 'border-2 border-emerald-200' : 'border border-border'}`}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="font-bold text-xl text-foreground">IF# {selectedOrder.if_number}</p>
              <p className="text-muted-foreground font-medium">{selectedOrder.customer}</p>
              <p className="text-muted-foreground text-sm">PO: {selectedOrder.po_number}</p>
              <div className="flex gap-3 text-sm text-muted-foreground mt-1">
                <span>Line: <strong className="text-muted-foreground">{selectedOrder.line_number}</strong></span>
                {selectedOrder.part_number && <span>Part: <strong className="text-muted-foreground">{selectedOrder.part_number}</strong></span>}
              </div>
            </div>
            {statusBadge(selectedOrder.status)}
          </div>

          {/* Progress bar */}
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">{t('prod.progress') || 'Progress'}</span>
              <span className="font-semibold text-foreground">{recorded}/{total} {t('prod.pallets').toLowerCase()} ({pct}%)</span>
            </div>
            <div className="w-full bg-muted rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-sky-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Start Order button — only show when Pending and no pallets yet */}
        {selectedOrder.status === 'pending' && realPallets.length === 0 && (
          <button
            onClick={startOrder}
            disabled={startingOrder}
            className="w-full mb-4 py-3 bg-amber-500 text-white rounded-xl font-bold text-base active:bg-amber-600 shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {startingOrder ? (
              <span className="animate-pulse">{t('prod.saving') || '...'}</span>
            ) : (
              <>{t('prod.startOrder')}</>
            )}
          </button>
        )}

        {/* Pallets header */}
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold text-foreground">{t('prod.palletList')}</h2>
          <div className="flex gap-2">
            {userRole === 'admin' && realPallets.length > 0 && (
              <button
                onClick={() => {
                  if (bulkEditMode) {
                    setBulkEditMode(false)
                  } else {
                    const edits: Record<string, { weight: string; length: string; width: string; height: string }> = {}
                    realPallets.forEach(p => {
                      edits[p.id] = {
                        weight: p.weight?.toString() || '',
                        length: p.length?.toString() || '',
                        width: p.width?.toString() || '',
                        height: p.height?.toString() || '',
                      }
                    })
                    setBulkEdits(edits)
                    setBulkEditMode(true)
                  }
                }}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${bulkEditMode ? 'bg-gray-500 text-white' : 'bg-amber-500 text-white active:bg-amber-600'}`}
              >
                {bulkEditMode ? '✕ Cancel' : '✏️ Edit All'}
              </button>
            )}
            <button
              onClick={() => openPalletForm()}
              className="px-4 py-2 bg-sky-600 text-white rounded-lg font-medium text-sm active:bg-sky-700 shadow-sm"
            >
              + {t('pallet.addPallet')}
            </button>
          </div>
        </div>

        {successMsg && (
          <div className="bg-emerald-50 text-emerald-700 p-3 rounded-lg mb-3 text-center font-medium border border-emerald-200">
            ✅ {successMsg}
          </div>
        )}

        {palletsLoading && <p className="text-center text-muted-foreground py-4">{t('common.loading')}</p>}

        {!palletsLoading && realPallets.length === 0 && (
          <div className="text-center py-8 bg-card rounded-xl shadow-sm border border-border">
            <p className="text-muted-foreground">{t('pallet.noPallets')}</p>
          </div>
        )}

        {bulkEditMode ? (
          <div className="space-y-2">
            <div className="grid grid-cols-5 gap-2 text-xs font-medium text-muted-foreground px-2">
              <span>#</span>
              <span>Weight (lbs)</span>
              <span>Length</span>
              <span>Width</span>
              <span>Height</span>
            </div>
            {realPallets.map((p) => (
              <div key={p.id} className="grid grid-cols-5 gap-2 bg-card rounded-lg p-2 border border-border">
                <span className="flex items-center font-semibold text-sm text-foreground">#{p.pallet_number}</span>
                <input type="number" value={bulkEdits[p.id]?.weight || ''} onChange={e => setBulkEdits(prev => ({...prev, [p.id]: {...prev[p.id], weight: e.target.value}}))} className="border rounded px-2 py-1 text-sm w-full text-foreground" placeholder="lbs" />
                <input type="number" value={bulkEdits[p.id]?.length || ''} onChange={e => setBulkEdits(prev => ({...prev, [p.id]: {...prev[p.id], length: e.target.value}}))} className="border rounded px-2 py-1 text-sm w-full text-foreground" placeholder="L" />
                <input type="number" value={bulkEdits[p.id]?.width || ''} onChange={e => setBulkEdits(prev => ({...prev, [p.id]: {...prev[p.id], width: e.target.value}}))} className="border rounded px-2 py-1 text-sm w-full text-foreground" placeholder="W" />
                <input type="number" value={bulkEdits[p.id]?.height || ''} onChange={e => setBulkEdits(prev => ({...prev, [p.id]: {...prev[p.id], height: e.target.value}}))} className="border rounded px-2 py-1 text-sm w-full text-foreground" placeholder="H" />
              </div>
            ))}
            {/* Quick-fill: apply same values to all */}
            <div className="mt-3 p-3 bg-sky-50 dark:bg-sky-950 rounded-lg border border-blue-200">
              <p className="text-xs font-medium text-sky-700 dark:text-sky-300 mb-2">Apply to all pallets:</p>
              <div className="grid grid-cols-5 gap-2">
                <span></span>
                <input id="bulk-weight" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="Weight" />
                <input id="bulk-length" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="L" />
                <input id="bulk-width" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="W" />
                <input id="bulk-height" type="number" className="border rounded px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground" placeholder="H" />
              </div>
              <button
                onClick={() => {
                  const w = (document.getElementById('bulk-weight') as HTMLInputElement)?.value || ''
                  const l = (document.getElementById('bulk-length') as HTMLInputElement)?.value || ''
                  const wd = (document.getElementById('bulk-width') as HTMLInputElement)?.value || ''
                  const h = (document.getElementById('bulk-height') as HTMLInputElement)?.value || ''
                  const updated: Record<string, { weight: string; length: string; width: string; height: string }> = {}
                  realPallets.forEach(p => {
                    updated[p.id] = {
                      weight: w || bulkEdits[p.id]?.weight || '',
                      length: l || bulkEdits[p.id]?.length || '',
                      width: wd || bulkEdits[p.id]?.width || '',
                      height: h || bulkEdits[p.id]?.height || '',
                    }
                  })
                  setBulkEdits(updated)
                }}
                className="mt-2 px-3 py-1 bg-sky-600 text-white rounded text-sm font-medium active:bg-sky-700"
              >
                Apply to All
              </button>
            </div>
            <button
              onClick={async () => {
                setBulkSaving(true)
                try {
                  const updates = Object.entries(bulkEdits).map(([id, vals]) => ({
                    id,
                    weight: vals.weight ? parseFloat(vals.weight) : null,
                    length: vals.length ? parseFloat(vals.length) : null,
                    width: vals.width ? parseFloat(vals.width) : null,
                    height: vals.height ? parseFloat(vals.height) : null,
                    edited_by: userId,
                    edited_by_name: userName,
                  }))
                  const res = await apiFetch('/api/pallet-records/pallets/bulk-update', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ updates }),
                  })
                  if (res.ok) {
                    setSuccessMsg('All pallets updated!')
                    setBulkEditMode(false)
                    if (selectedOrder) fetchPallets(selectedOrder.line_number)
                  }
                } catch { /* ignore */ }
                setBulkSaving(false)
              }}
              disabled={bulkSaving}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold text-base active:bg-emerald-700 disabled:opacity-50"
            >
              {bulkSaving ? 'Saving...' : `💾 Save All (${realPallets.length} pallets)`}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {realPallets.map((p) => (
              <div key={p.id} className="bg-card rounded-xl shadow-sm border border-border flex overflow-hidden">
                <button
                  onClick={() => openPalletForm(p)}
                  className="flex-1 text-left p-3 hover:bg-muted active:bg-muted transition-colors"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-foreground">#{p.pallet_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {p.weight && `${p.weight} lbs`}
                        {p.parts_per_pallet && ` · ${p.parts_per_pallet} pcs`}
                        {p.length && p.width && p.height && ` · ${p.length}×${p.width}×${p.height}″`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.photo_urls?.filter(Boolean).length > 0 && (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">📷 {p.photo_urls.filter(Boolean).length}</span>
                      )}
                      <span className="text-muted-foreground text-sm">✏️</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p.recorded_by_name || 'Unknown'}
                    {p.edited_by_name && ` · ${t('pallet.editedBy')}: ${p.edited_by_name}`}
                  </p>
                </button>
                <button
                  onClick={() => handleDeletePallet(p.id)}
                  className="px-3 flex items-center justify-center bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-500 transition-colors border-l border-border"
                  title="Delete pallet"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ==================== PALLET FORM ====================
  if (view === 'pallet-form' && selectedOrder) {
    return (
      <div className="p-4 max-w-2xl mx-auto">
        <button onClick={() => setView('detail')} className="text-sky-600 dark:text-sky-400 font-medium mb-4 text-base">
          {t('prod.back')}
        </button>

        <h2 className="text-xl font-bold text-foreground mb-4">
          {editingPallet ? t('pallet.editTitle') : t('pallet.title')}
        </h2>

        <div className="bg-card rounded-xl shadow-sm p-4 space-y-4 border border-border">
          {/* Order context */}
          <div className="bg-muted rounded-lg p-3 text-sm border border-border">
            <p className="text-foreground"><strong>IF# {selectedOrder.if_number}</strong> · {selectedOrder.customer}</p>
            <p className="text-muted-foreground">Line: {selectedOrder.line_number} {selectedOrder.part_number && `· Part: ${selectedOrder.part_number}`}</p>
          </div>

          {/* Pre-fill notice */}
          {prefilled && !editingPallet && (
            <div className="bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 p-3 rounded-lg text-sm border border-blue-200">
              ℹ️ {t('pallet.prefilled') || 'Pre-filled from previous pallet. Confirm or edit values below.'}
            </div>
          )}

          {/* Pallet Number */}
          <div>
            <label className="block text-sm font-semibold text-muted-foreground mb-1">{t('pallet.number')}</label>
            <input
              type="number"
              value={palletNumber}
              readOnly
              className="w-full border-2 border-border rounded-lg p-3 text-lg font-semibold text-foreground bg-muted"
            />
          </div>

          {/* Weight */}
          <div>
            <label className="block text-sm font-semibold text-muted-foreground mb-1">{t('pallet.weight')}</label>
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="0"
              className="w-full border-2 border-border rounded-lg p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
              inputMode="decimal"
            />
          </div>

          {/* Parts per Pallet */}
          <div>
            <label className="block text-sm font-semibold text-muted-foreground mb-1">{t('pallet.parts')}</label>
            <input
              type="number"
              value={partsPerPallet}
              onChange={(e) => setPartsPerPallet(e.target.value)}
              placeholder="0"
              className="w-full border-2 border-border rounded-lg p-3 text-lg text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
              inputMode="numeric"
            />
          </div>

          {/* Dimensions */}
          <div>
            <label className="block text-sm font-semibold text-muted-foreground mb-2">{t('pallet.dimensions')}</label>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('pallet.length')}</label>
                <input
                  type="number"
                  value={lengthVal}
                  onChange={(e) => setLengthVal(e.target.value)}
                  placeholder="L"
                  className="w-full border-2 border-border rounded-lg p-3 text-lg text-center text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('pallet.width')}</label>
                <input
                  type="number"
                  value={widthVal}
                  onChange={(e) => setWidthVal(e.target.value)}
                  placeholder="W"
                  className="w-full border-2 border-border rounded-lg p-3 text-lg text-center text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">{t('pallet.height')}</label>
                <input
                  type="number"
                  value={heightVal}
                  onChange={(e) => setHeightVal(e.target.value)}
                  placeholder="H"
                  className="w-full border-2 border-border rounded-lg p-3 text-lg text-center text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:focus:border-sky-400 focus:outline-none"
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>

          {/* Photos */}
          <div>
            <label className="block text-sm font-semibold text-muted-foreground mb-2">{t('pallet.photos')}</label>
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    {idx === 0 ? t('pallet.photo1') : t(`pallet.photo${idx + 1}` as 'pallet.photo2')}
                  </label>
                  {photoUrls[idx] ? (
                    <div className="relative">
                      <a href={photoUrls[idx]} target="_blank" rel="noreferrer"
                        className="block w-full h-24 bg-sky-50 dark:bg-sky-950 border-2 border-blue-300 rounded-lg overflow-hidden">
                        <img
                          src={photoUrls[idx]}
                          alt={`Photo ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </a>
                      <button
                        onClick={() => {
                          const newPhotos = [...photoUrls]
                          newPhotos[idx] = ''
                          setPhotoUrls(newPhotos)
                        }}
                        className="absolute -top-1 -right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs font-bold shadow"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="block w-full h-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-sky-400 active:bg-sky-50 dark:active:bg-sky-950 transition-colors">
                      <div className="text-center">
                        <span className="text-2xl">📷</span>
                        <p className="text-xs text-muted-foreground font-medium">{t('pallet.photo')}</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handlePhotoUpload(e, idx)}
                        disabled={uploading}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
            {uploading && (
              <p className="text-center text-sky-600 dark:text-sky-400 text-sm mt-2 font-medium">{t('pallet.uploading')}</p>
            )}
            {uploadError && (
              <p className="text-center text-red-600 text-sm mt-2 font-medium">⚠️ {uploadError}</p>
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSavePallet}
            disabled={saving || uploading}
            className="w-full py-4 bg-sky-600 text-white rounded-xl font-bold text-lg active:bg-sky-700 disabled:opacity-50 shadow-sm transition-colors"
          >
            {saving ? t('pallet.saving') : editingPallet ? t('pallet.update') : t('pallet.submit')}
          </button>

          {successMsg && (
            <p className="text-center text-emerald-600 font-semibold">✅ {successMsg}</p>
          )}
        </div>
      </div>
    )
  }

  return null
}
