'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { userHeaders } from '@/lib/quality/form-utils'
import { usePalletAccess } from '@/lib/use-pallet-access'

interface AuditEntry {
  id: string
  record_type: string
  record_id: string
  action: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  changed_by: string
  changed_by_name: string
  created_at: string
}

export default function AuditTrail() {
  const { profile } = useAuth()
  const { isPalletAdmin } = usePalletAccess()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pallet' | 'shipping'>('all')
  const [photoViewer, setPhotoViewer] = useState<string | null>(null)

  const [userId, setUserId] = useState('')
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState<string>('user')
  const [restoringFull, setRestoringFull] = useState<string | null>(null)

  const fetchEntries = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '100' })
    if (filter !== 'all') params.set('record_type', filter)

    const res = await fetch(`/api/pallet-records/audit?${params}`, { headers: userHeaders(profile?.id) })
    if (res.ok) {
      const data = await res.json()
      setEntries(data)
    }
    setLoading(false)
  }, [filter, profile?.id])

  useEffect(() => {
    fetchEntries()
    setUserId(profile?.email || profile?.id || '')
    setUserName(profile?.full_name || profile?.email?.split('@')[0] || '')
    setUserRole(isPalletAdmin ? 'admin' : 'user')
  }, [fetchEntries, profile?.email, profile?.full_name, profile?.id, isPalletAdmin])

  const getPhotoChanges = (entry: AuditEntry) => {
    const oldPhotos: string[] = (entry.old_data?.photo_urls as string[]) || []
    const newPhotos: string[] = (entry.new_data?.photo_urls as string[]) || []

    const removed = oldPhotos.filter(p => p && !newPhotos.includes(p))
    const added = newPhotos.filter(p => p && !oldPhotos.includes(p))

    return { oldPhotos, newPhotos, removed, added, hasPhotoChanges: removed.length > 0 || added.length > 0 }
  }

  const handleRestore = async (entry: AuditEntry) => {
    if (!confirm('Restore old photos from this audit entry? This will add back any removed photos.')) return

    setRestoring(entry.id)
    try {
      const res = await fetch('/api/pallet-records/audit', {
        method: 'POST',
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          audit_id: entry.id,
          restore_photos: true,
          edited_by: userId,
          edited_by_name: userName,
        }),
      })
      if (res.ok) {
        alert('✅ Photos restored successfully')
        fetchEntries()
      } else {
        const data = await res.json()
        alert(`Failed: ${data.error}`)
      }
    } catch {
      alert('Network error')
    }
    setRestoring(null)
  }

  // Full-row restore — re-inserts a deleted record back into its table.
  // Admin-only; enforced server-side.
  const handleRestoreFull = async (entry: AuditEntry) => {
    if (userRole !== 'admin') return
    const label = entry.record_type === 'shipping' ? 'shipment' : entry.record_type
    if (!confirm(`Restore this deleted ${label}?\n\nA new row will be inserted using the data captured at delete time.`)) return

    setRestoringFull(entry.id)
    try {
      const res = await fetch('/api/pallet-records/audit', {
        method: 'POST',
        headers: userHeaders(profile?.id),
        body: JSON.stringify({
          audit_id: entry.id,
          restore_full: true,
          edited_by: userId,
          edited_by_name: userName,
        }),
      })
      if (res.ok) {
        alert(`✅ ${label.charAt(0).toUpperCase() + label.slice(1)} record restored.`)
        fetchEntries()
      } else {
        const data = await res.json().catch(() => ({ error: 'Failed' }))
        if (res.status === 409 && data.existing_record_id) {
          alert(`Already restored earlier (record ${String(data.existing_record_id).slice(0, 8)}…). Nothing to do.`)
        } else {
          alert(`Failed: ${data.error || 'Unknown error'}`)
        }
      }
    } catch {
      alert('Network error')
    }
    setRestoringFull(null)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  const actionLabels: Record<string, { label: string; color: string }> = {
    create: { label: '🆕 Created', color: 'bg-emerald-100 text-emerald-700' },
    'create-pallet-photo': { label: '📷 Pallet Photo Saved', color: 'bg-amber-100 text-amber-700' },
    'merge-pallet-photo': { label: '📷 Pallet Photo Merged', color: 'bg-amber-100 text-amber-700' },
    edit: { label: '✏️ Edited', color: 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300' },
    delete: { label: '🗑️ Deleted', color: 'bg-red-100 text-red-700' },
    photo_restore: { label: '🔄 Photos Restored', color: 'bg-purple-100 text-purple-700' },
    restore: { label: '♻️ Restored', color: 'bg-purple-100 text-purple-700' },
  }

  const getChangedFields = (entry: AuditEntry) => {
    if (!entry.old_data || !entry.new_data) return []
    const fields: { field: string; old: string; new: string }[] = []
    const skip = ['id', 'created_at', 'edited_at', 'edited_by', 'edited_by_name', 'recorded_by', 'recorded_by_name']

    for (const key of Object.keys(entry.new_data)) {
      if (skip.includes(key)) continue
      const oldVal = JSON.stringify(entry.old_data[key])
      const newVal = JSON.stringify(entry.new_data[key])
      if (oldVal !== newVal) {
        fields.push({
          field: key.replace(/_/g, ' '),
          old: entry.old_data[key]?.toString() || '—',
          new: entry.new_data[key]?.toString() || '—',
        })
      }
    }
    return fields
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-gradient-to-r from-card to-card text-white rounded-xl p-4 mb-4 shadow-lg">
        <h1 className="text-xl font-bold">📋 Audit Trail</h1>
        <p className="text-muted-foreground text-sm">Track all changes · Photo history & restore</p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['all', 'pallet', 'shipping'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-card text-muted-foreground border border-border hover:bg-muted'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && <p className="text-center text-muted-foreground py-8">Loading...</p>}

      {!loading && entries.length === 0 && (
        <div className="text-center py-8 bg-card rounded-xl shadow-sm border border-border">
          <p className="text-muted-foreground">No audit entries yet</p>
        </div>
      )}

      <div className="space-y-3">
        {entries.map((entry) => {
          const isExpanded = expandedId === entry.id
          const { removed, added, hasPhotoChanges, oldPhotos, newPhotos } = getPhotoChanges(entry)
          const actionInfo = actionLabels[entry.action] || { label: entry.action, color: 'bg-muted text-muted-foreground' }
          const changes = getChangedFields(entry)

          return (
            <div key={entry.id} className="bg-card rounded-xl shadow-sm border border-border overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                className="w-full text-left p-4 hover:bg-muted active:bg-muted transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${actionInfo.color}`}>
                        {actionInfo.label}
                      </span>
                      <span className="text-xs text-muted-foreground uppercase">{entry.record_type}</span>
                      {hasPhotoChanges && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                          📷 Photos changed
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground font-medium">
                      Record: {entry.record_id.slice(0, 8)}...
                      {(entry.new_data?.line_number || entry.old_data?.line_number) ? ` · Line ${String(entry.new_data?.line_number || entry.old_data?.line_number)}` : ''}
                      {(entry.new_data?.pallet_number || entry.old_data?.pallet_number) ? ` · Pallet #${String(entry.new_data?.pallet_number || entry.old_data?.pallet_number)}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {entry.changed_by_name || 'Unknown'} · {formatDate(entry.created_at)}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-lg">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border p-4 bg-muted space-y-4">
                  {/* Field changes */}
                  {changes.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Changes</h4>
                      <div className="space-y-1">
                        {changes.filter(c => c.field !== 'photo urls').map((c, i) => (
                          <div key={i} className="flex text-sm">
                            <span className="font-medium text-muted-foreground w-32 capitalize">{c.field}:</span>
                            <span className="text-red-500 line-through mr-2">{c.old}</span>
                            <span className="text-emerald-600">→ {c.new}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Photo changes */}
                  {hasPhotoChanges && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Photo Changes</h4>

                      {removed.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-red-600 mb-1">🗑️ Removed ({removed.length})</p>
                          <div className="grid grid-cols-4 gap-2">
                            {removed.map((url, i) => (
                              <button
                                key={i}
                                onClick={() => setPhotoViewer(url)}
                                className="w-full h-16 bg-red-50 border-2 border-red-200 rounded-lg overflow-hidden hover:border-red-400 transition-colors"
                              >
                                <img src={url} alt={`Removed ${i + 1}`} className="w-full h-full object-cover opacity-75" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {added.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-medium text-emerald-600 mb-1">➕ Added ({added.length})</p>
                          <div className="grid grid-cols-4 gap-2">
                            {added.map((url, i) => (
                              <button
                                key={i}
                                onClick={() => setPhotoViewer(url)}
                                className="w-full h-16 bg-emerald-50 border-2 border-emerald-200 rounded-lg overflow-hidden hover:border-emerald-400 transition-colors"
                              >
                                <img src={url} alt={`Added ${i + 1}`} className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Before / After comparison */}
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Before ({oldPhotos.filter(Boolean).length})</p>
                          <div className="grid grid-cols-2 gap-1">
                            {oldPhotos.filter(Boolean).map((url, i) => (
                              <button
                                key={i}
                                onClick={() => setPhotoViewer(url)}
                                className="w-full h-12 bg-muted border rounded overflow-hidden"
                              >
                                <img src={url} alt="" className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">After ({newPhotos.filter(Boolean).length})</p>
                          <div className="grid grid-cols-2 gap-1">
                            {newPhotos.filter(Boolean).map((url, i) => (
                              <button
                                key={i}
                                onClick={() => setPhotoViewer(url)}
                                className="w-full h-12 bg-muted border rounded overflow-hidden"
                              >
                                <img src={url} alt="" className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Restore button */}
                      {removed.length > 0 && (
                        <button
                          onClick={() => handleRestore(entry)}
                          disabled={restoring === entry.id}
                          className="mt-3 w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm active:bg-purple-700 disabled:opacity-50 shadow-sm"
                        >
                          {restoring === entry.id ? 'Restoring...' : `🔄 Restore ${removed.length} removed photo${removed.length > 1 ? 's' : ''}`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Deleted record info */}
                  {entry.action === 'delete' && entry.old_data && (
                    <div>
                      <h4 className="text-xs font-semibold text-red-500 uppercase mb-2">Deleted Record</h4>
                      <div className="space-y-1 text-sm">
                        {entry.record_type === 'pallet' && (
                          <>
                            {entry.old_data.weight ? <p><span className="text-muted-foreground">Weight:</span> {String(entry.old_data.weight)} lbs</p> : null}
                            {entry.old_data.parts_per_pallet ? <p><span className="text-muted-foreground">Parts:</span> {String(entry.old_data.parts_per_pallet)}</p> : null}
                          </>
                        )}
                        {entry.record_type === 'shipping' && (
                          <>
                            {entry.old_data.order_id ? <p><span className="text-muted-foreground">Order:</span> {String(entry.old_data.order_id)}</p> : null}
                            {entry.old_data.carrier ? <p><span className="text-muted-foreground">Carrier:</span> {String(entry.old_data.carrier)}</p> : null}
                            {entry.old_data.customer ? <p><span className="text-muted-foreground">Customer:</span> {String(entry.old_data.customer)}</p> : null}
                            {entry.old_data.system_type ? <p><span className="text-muted-foreground">System:</span> {String(entry.old_data.system_type)}</p> : null}
                            {entry.old_data.if_number ? <p><span className="text-muted-foreground">IF#:</span> {String(entry.old_data.if_number)}</p> : null}
                          </>
                        )}
                      </div>
                      {(() => {
                        const allPhotos = [
                          ...((entry.old_data.photo_urls as string[]) || []),
                          ...((entry.old_data.shipment_photos as string[]) || []),
                          ...((entry.old_data.paperwork_photos as string[]) || []),
                          ...((entry.old_data.closeup_photos as string[]) || []),
                          ...((entry.old_data.pallet_photos as string[]) || []),
                        ].filter(Boolean)
                        if (allPhotos.length === 0) return null
                        return (
                          <div className="mt-2">
                            <p className="text-xs font-medium text-muted-foreground mb-1">Photos from deleted record ({allPhotos.length}):</p>
                            <div className="grid grid-cols-4 gap-2">
                              {allPhotos.map((url, i) => (
                                <button
                                  key={i}
                                  onClick={() => setPhotoViewer(url)}
                                  className="w-full h-16 bg-muted border rounded-lg overflow-hidden hover:border-sky-400"
                                >
                                  <img src={url} alt="" className="w-full h-full object-cover" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Full-row restore — admin only */}
                      {userRole === 'admin' && (
                        <button
                          onClick={() => handleRestoreFull(entry)}
                          disabled={restoringFull === entry.id}
                          className="mt-3 w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm active:bg-purple-700 disabled:opacity-50 shadow-sm"
                        >
                          {restoringFull === entry.id ? 'Restoring...' : `♻️ Restore deleted ${entry.record_type}`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* No changes */}
                  {changes.length === 0 && !hasPhotoChanges && entry.action === 'create' && (
                    <p className="text-sm text-muted-foreground italic">Initial record creation</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Photo lightbox */}
      {photoViewer && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPhotoViewer(null)}
        >
          <div className="max-w-lg w-full">
            <img src={photoViewer} alt="Full size" className="w-full rounded-lg shadow-2xl" />
            <p className="text-center text-white/70 text-sm mt-2">Tap to close</p>
          </div>
        </div>
      )}
    </div>
  )
}
