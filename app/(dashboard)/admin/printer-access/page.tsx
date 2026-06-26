'use client'

import { useEffect, useState, useCallback } from 'react'
import { authHeaders } from '@/lib/session-token'
import { Printer, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface AclUser {
  id: string
  email: string
  name: string | null
  role: string
  isAdmin: boolean
}
interface AclStation {
  id: string
  name: string
  location: string | null
  enabled: boolean
}

const cellKey = (userId: string, stationId: string) => `${userId}::${stationId}`

export default function PrinterAccessPage() {
  const { t } = useI18n()
  const [users, setUsers] = useState<AclUser[]>([])
  const [stations, setStations] = useState<AclStation[]>([])
  const [denied, setDenied] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busyCell, setBusyCell] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/printer-access', { headers: authHeaders(), cache: 'no-store' })
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      setUsers(data.users ?? [])
      setStations((data.stations ?? []).filter((s: AclStation) => s.enabled))
      setDenied(new Set((data.denied ?? []).map((d: { user_id: string; station_id: string }) => cellKey(d.user_id, d.station_id))))
    } catch {
      setError(t('printerAccess.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // Toggle one cell. Optimistic; reverts on failure. Default-allow: checked =
  // allowed (no deny row), unchecked = denied.
  // `currentlyChecked` is read from the rendered cell, not the `denied` state, so
  // rapid clicks can't compute against a stale closure.
  const toggleCell = useCallback(
    async (u: AclUser, stationId: string, currentlyChecked: boolean) => {
      if (u.isAdmin) return // admins always have all printers
      const key = cellKey(u.id, stationId)
      const nextAllowed = !currentlyChecked
      setBusyCell(key)
      setError(null)
      setDenied((prev) => {
        const n = new Set(prev)
        if (nextAllowed) n.delete(key)
        else n.add(key)
        return n
      })
      try {
        const res = await fetch('/api/admin/printer-access', {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ user_id: u.id, station_id: stationId, allowed: nextAllowed }),
        })
        if (!res.ok) throw new Error(String(res.status))
      } catch {
        // revert to the pre-click state
        setDenied((prev) => {
          const n = new Set(prev)
          if (nextAllowed) n.add(key)
          else n.delete(key)
          return n
        })
        setError(t('printerAccess.saveError'))
      } finally {
        setBusyCell(null)
      }
    },
    [t]
  )

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    )
  }

  if (forbidden) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">{t('printerAccess.forbidden')}</p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Printer className="size-6" />
          {t('page.adminPrinterAccess')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('page.adminPrinterAccessSubtitle')}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {stations.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground">{t('printerAccess.noStations')}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="sticky left-0 z-10 bg-muted/50 px-4 py-3 text-left font-medium">{t('printerAccess.user')}</th>
                {stations.map((s) => (
                  <th key={s.id} className="px-3 py-3 text-center font-medium">
                    <div className="flex flex-col items-center gap-0.5">
                      <Printer className="size-4 text-muted-foreground" />
                      <span>{s.name}</span>
                      {s.location && <span className="text-xs font-normal text-muted-foreground">{s.location}</span>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b hover:bg-muted/30">
                  <td className="sticky left-0 z-10 bg-background px-4 py-2">
                    <div className="font-medium">{u.name || u.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.email}
                      {u.isAdmin && <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t('printerAccess.allAccess')}</span>}
                    </div>
                  </td>
                  {stations.map((s) => {
                    const key = cellKey(u.id, s.id)
                    const checked = u.isAdmin || !denied.has(key)
                    return (
                      <td key={s.id} className="px-3 py-2 text-center">
                        {busyCell === key ? (
                          <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={u.isAdmin}
                            onChange={() => void toggleCell(u, s.id, checked)}
                            title={u.isAdmin ? t('printerAccess.allAccess') : undefined}
                            className="size-4 cursor-pointer rounded border-gray-300 text-primary accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
