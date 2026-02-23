'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth, SUPER_ADMIN_EMAIL } from '@/lib/auth-context'
import { Bell, Send, Users, History } from 'lucide-react'
import { useI18n } from '@/lib/i18n'

interface UserRecord {
  id: string
  email: string
  full_name: string | null
  role: string
  is_active: boolean
}

interface NotifLog {
  id: string
  title: string
  body: string | null
  sent_by: string | null
  target_role: string | null
  target_user_id: string | null
  sent_count: number
  created_at: string
}

const ROLES = ['admin', 'manager', 'group_leader', 'regular_user', 'visitor']

export default function NotificationsAdminPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [logs, setLogs] = useState<NotifLog[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('/')
  const [targetType, setTargetType] = useState<'all' | 'role' | 'user'>('all')
  const [targetRole, setTargetRole] = useState('regular_user')
  const [targetUserId, setTargetUserId] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const isAdmin = user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()

  const fetchData = useCallback(async () => {
    if (!user) return
    const [usersRes, logsRes] = await Promise.all([
      fetch('/api/admin/users', { headers: { 'x-user-id': user.id } }),
      fetch('/api/notifications/log', { headers: { 'x-user-id': user.id } }),
    ])
    if (usersRes.ok) {
      const data = await usersRes.json()
      setUsers(data.users ?? [])
    }
    if (logsRes.ok) {
      const data = await logsRes.json()
      setLogs(data.logs ?? [])
    }
    setLoading(false)
  }, [user])

  useEffect(() => { fetchData() }, [fetchData])

  async function sendNotification() {
    if (!title || !user) return
    setSending(true)
    setResult(null)
    try {
      const payload: Record<string, string> = { title, body, url, sentBy: user.id }
      if (targetType === 'role') payload.targetRole = targetRole
      if (targetType === 'user') payload.targetUserId = targetUserId

      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ type: 'success', message: `✅ Sent to ${data.sent}/${data.total} devices` })
        setTitle('')
        setBody('')
        await fetchData()
      } else {
        setResult({ type: 'error', message: data.error || 'Failed to send' })
      }
    } catch {
      setResult({ type: 'error', message: 'Network error' })
    }
    setSending(false)
  }

  if (!isAdmin) {
    return <p className="text-center text-muted-foreground py-10">Admin access required</p>
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="size-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" /></div>
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="size-6" /> Notification Center</h1>
        <p className="text-sm text-muted-foreground">Send push notifications to users</p>
      </div>

      {/* Send notification form */}
      <div className="rounded-lg border bg-card p-4 space-y-4 max-w-2xl">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Send className="size-4" /> Send Notification</h2>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Title *</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Order #2587 completed"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Body</label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Gleason Industrial Products — 7,680 units ready to ship"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm h-20 resize-none"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Link URL</label>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="/orders"
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Target</label>
          <div className="flex gap-2 mb-2">
            {(['all', 'role', 'user'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTargetType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  targetType === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
                }`}
              >
                {t === 'all' ? '📢 All Users' : t === 'role' ? '👥 By Role' : '👤 Specific User'}
              </button>
            ))}
          </div>

          {targetType === 'role' && (
            <select
              value={targetRole}
              onChange={e => setTargetRole(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            >
              {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
          )}

          {targetType === 'user' && (
            <select
              value={targetUserId}
              onChange={e => setTargetUserId(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <option value="">Select user...</option>
              {users.filter(u => u.is_active).map(u => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={sendNotification}
          disabled={sending || !title}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {sending ? 'Sending...' : '🔔 Send Notification'}
        </button>

        {result && (
          <p className={`text-sm ${result.type === 'success' ? 'text-green-500' : 'text-destructive'}`}>
            {result.message}
          </p>
        )}
      </div>

      {/* Recent notification log */}
      <div className="rounded-lg border bg-card p-4 max-w-2xl">
        <h2 className="text-sm font-semibold flex items-center gap-2 mb-3"><History className="size-4" /> Recent Notifications</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications sent yet</p>
        ) : (
          <div className="space-y-2">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 text-xs border-b border-border/40 pb-2">
                <div className="flex-1">
                  <p className="font-medium">{log.title}</p>
                  {log.body && <p className="text-muted-foreground">{log.body}</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {log.target_role ? `Role: ${log.target_role}` : log.target_user_id ? 'Specific user' : 'All users'}
                    {' · '}{log.sent_count} delivered
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(log.created_at).toLocaleDateString()} {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
