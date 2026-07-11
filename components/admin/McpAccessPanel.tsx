'use client'

/**
 * "AI Connectors (MCP)" panel on the admin Users page: global kill switch,
 * per-user grants with permission level, and the recent request log.
 */

import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from '@/lib/session-token'
import { useI18n } from '@/lib/i18n'
import { Bot, Plus, Trash2 } from 'lucide-react'

interface McpGrant {
  user_id: string
  email: string
  enabled: boolean
  scope: string
  granted_by: string | null
  created_at: string
}

interface McpLogRow {
  ts: string
  email: string | null
  method: string
  tool: string | null
  ok: boolean
  error: string | null
  latency_ms: number | null
}

interface DashboardUser {
  id: string
  email: string
  full_name: string | null
}

// production_only / financial are intentionally not offered yet — the backend
// supports them, but v1 keeps a single level until Simon wants tiers.
const SCOPE_OPTIONS = ['full_read']

export function McpAccessPanel({ users }: { users: DashboardUser[] }) {
  const { t } = useI18n()
  const [globalEnabled, setGlobalEnabled] = useState(false)
  const [grants, setGrants] = useState<McpGrant[]>([])
  const [log, setLog] = useState<McpLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [addUserId, setAddUserId] = useState('')

  const refresh = useCallback(async () => {
    const res = await fetch('/api/admin/mcp-access', { headers: authHeaders() })
    if (res.ok) {
      const data = await res.json()
      setGlobalEnabled(data.globalEnabled)
      setGrants(data.grants ?? [])
      setLog(data.recentRequests ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const put = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true)
      await fetch('/api/admin/mcp-access', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      })
      await refresh()
      setSaving(false)
    },
    [refresh]
  )

  const ungrantedUsers = users.filter((u) => !grants.some((g) => g.user_id === u.id))

  if (loading) return null

  return (
    <div className="mt-8 rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">{t('mcpAdmin.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('mcpAdmin.subtitle')}</p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <span className={globalEnabled ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>
            {globalEnabled ? t('mcpAdmin.globalOn') : t('mcpAdmin.globalOff')}
          </span>
          <button
            onClick={() => put({ action: 'set_global', enabled: !globalEnabled })}
            disabled={saving}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              globalEnabled ? 'bg-green-500' : 'bg-muted-foreground/30'
            }`}
            aria-label={t('mcpAdmin.killSwitch')}
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                globalEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </label>
      </div>

      <div className="p-4">
        {grants.length === 0 ? (
          <p className="mb-3 text-sm text-muted-foreground">{t('mcpAdmin.noGrants')}</p>
        ) : (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t('table.email')}</th>
                  <th className="py-2 pr-4 font-medium">{t('mcpAdmin.level')}</th>
                  <th className="py-2 pr-4 font-medium">{t('table.status')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.user_id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{g.email}</td>
                    <td className="py-2 pr-4">
                      <select
                        value={g.scope}
                        onChange={(e) => put({ action: 'update', user_id: g.user_id, scope: e.target.value })}
                        disabled={saving || SCOPE_OPTIONS.length < 2}
                        className="rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        {SCOPE_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {t(`mcpAdmin.scope.${s}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-4">
                      <button
                        onClick={() => put({ action: 'update', user_id: g.user_id, enabled: !g.enabled })}
                        disabled={saving}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          g.enabled
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {g.enabled ? t('mcpAdmin.enabled') : t('mcpAdmin.disabled')}
                      </button>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => put({ action: 'revoke', user_id: g.user_id })}
                        disabled={saving}
                        title={t('mcpAdmin.revoke')}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">{t('mcpAdmin.selectUser')}</option>
            {ungrantedUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ? `${u.full_name} — ${u.email}` : u.email}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (addUserId) {
                put({ action: 'grant', user_id: addUserId, scope: 'full_read' })
                setAddUserId('')
              }
            }}
            disabled={saving || !addUserId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="size-4" />
            {t('mcpAdmin.grantAccess')}
          </button>
        </div>

        <button
          onClick={() => setShowLog(!showLog)}
          className="mt-4 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {showLog ? t('mcpAdmin.hideLog') : t('mcpAdmin.showLog')} ({log.length})
        </button>
        {showLog && (
          <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border bg-muted/20 p-2">
            {log.length === 0 && <p className="p-2 text-xs text-muted-foreground">{t('mcpAdmin.emptyLog')}</p>}
            {log.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5 text-xs last:border-0">
                <span className={row.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive'}>
                  {row.ok ? '✓' : '✗'}
                </span>
                <span className="text-muted-foreground">{new Date(row.ts).toLocaleString()}</span>
                <span className="font-medium">{row.email ?? '—'}</span>
                <span>{row.tool ?? row.method}</span>
                {row.latency_ms != null && <span className="text-muted-foreground">{row.latency_ms}ms</span>}
                {row.error && <span className="text-destructive">{row.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
