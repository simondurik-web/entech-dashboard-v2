'use client'

import { useCallback, useEffect, useState } from 'react'
import { MonitorSmartphone, Trash2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

// Authorized devices (shared floor computers) — pairing requests appear here;
// approving assigns a role the admin can change on the fly. Devices can never
// hold the admin role (also enforced server-side).

interface DeviceRecord {
  id: string
  pairing_code: string
  name: string
  role: string
  status: 'pending' | 'approved' | 'revoked'
  user_agent: string | null
  requested_at: string
  approved_at: string | null
  last_seen_at: string | null
}

const DEVICE_ROLES = ['visitor', 'regular_user', 'advanced_user', 'group_leader', 'shipping_manager', 'manager']

export function DevicesPanel({ adminUserId }: { adminUserId: string }) {
  const { t } = useI18n()
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchDevices = useCallback(async () => {
    const res = await fetch('/api/admin/devices', { headers: { 'x-user-id': adminUserId } })
    if (res.ok) {
      const data = await res.json()
      setDevices(data.devices ?? [])
    }
    setLoading(false)
  }, [adminUserId])

  useEffect(() => {
    fetchDevices()
    // Pending pairings show up without a manual reload while the admin has
    // the page open next to the floor PC.
    const interval = window.setInterval(fetchDevices, 15000)
    return () => window.clearInterval(interval)
  }, [fetchDevices])

  const updateDevice = async (id: string, patch: Record<string, unknown>) => {
    setSaving(id)
    await fetch('/api/admin/devices', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-user-id': adminUserId },
      body: JSON.stringify({ id, ...patch }),
    })
    await fetchDevices()
    setSaving(null)
  }

  const deleteDevice = async (id: string) => {
    if (!window.confirm(t('device.deleteConfirm'))) return
    setSaving(id)
    await fetch('/api/admin/devices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-user-id': adminUserId },
      body: JSON.stringify({ id }),
    })
    await fetchDevices()
    setSaving(null)
  }

  const statusBadge = (status: DeviceRecord['status']) => {
    if (status === 'approved')
      return <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">{t('device.statusApproved')}</span>
    if (status === 'pending')
      return <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">{t('device.statusPending')}</span>
    return <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-800 dark:bg-red-900/30 dark:text-red-400">{t('device.statusRevoked')}</span>
  }

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <MonitorSmartphone className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t('device.panelTitle')}</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t('device.panelSubtitle')}</p>

      {loading ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">…</div>
      ) : devices.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          {t('device.noDevices')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">{t('device.colName')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('device.colCode')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('table.role')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('table.status')}</th>
                <th className="px-4 py-3 text-left font-medium">{t('device.colLastSeen')}</th>
                <th className="px-4 py-3 text-left font-medium" />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <input
                      defaultValue={d.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== d.name) updateDevice(d.id, { name: v })
                      }}
                      disabled={saving === d.id}
                      className="w-40 rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold tracking-widest">{d.pairing_code}</td>
                  <td className="px-4 py-3">
                    <select
                      value={d.role}
                      onChange={(e) => updateDevice(d.id, { role: e.target.value })}
                      disabled={saving === d.id}
                      className="rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {DEVICE_ROLES.map((r) => (
                        <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">{statusBadge(d.status)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : t('admin.never')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {d.status !== 'approved' ? (
                        <button
                          onClick={() => updateDevice(d.id, { action: 'approve', role: d.role })}
                          disabled={saving === d.id}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                        >
                          {t('device.approve')}
                        </button>
                      ) : (
                        <button
                          onClick={() => updateDevice(d.id, { action: 'revoke' })}
                          disabled={saving === d.id}
                          className="rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {t('device.revoke')}
                        </button>
                      )}
                      <button
                        onClick={() => deleteDevice(d.id)}
                        disabled={saving === d.id}
                        title={t('device.delete')}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
