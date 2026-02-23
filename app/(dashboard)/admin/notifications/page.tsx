'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth, SUPER_ADMIN_EMAIL } from '@/lib/auth-context'
import { Bell, Send, History, Zap, Check } from 'lucide-react'
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

interface NotifRule {
  id: string
  event_type: string
  user_id: string
  enabled: boolean
}

const ROLES = ['admin', 'manager', 'group_leader', 'regular_user', 'visitor']

const EVENT_TYPES = [
  { key: 'order_urgent', label: '🚨 Order Marked Urgent', description: 'Notify when any order is flagged as URGENT' },
  { key: 'order_staged', label: '📦 Order Changed to Staged', description: 'Notify when an order status changes to Staged (Ready to Ship)' },
]

export default function NotificationsAdminPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [logs, setLogs] = useState<NotifLog[]>([])
  const [rules, setRules] = useState<NotifRule[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('/')
  const [targetType, setTargetType] = useState<'all' | 'role' | 'user'>('all')
  const [targetRole, setTargetRole] = useState('regular_user')
  const [targetUserId, setTargetUserId] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingRules, setSavingRules] = useState<string | null>(null)
  const [rulesSaved, setRulesSaved] = useState<string | null>(null)

  const isAdmin = user?.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()

  // Track selected user IDs per event type
  const [selectedUsers, setSelectedUsers] = useState<Record<string, Set<string>>>({})

  const fetchData = useCallback(async () => {
    if (!user) return
    const [usersRes, logsRes, rulesRes] = await Promise.all([
      fetch('/api/admin/users', { headers: { 'x-user-id': user.id } }),
      fetch('/api/notifications/log', { headers: { 'x-user-id': user.id } }),
      fetch('/api/notification-rules'),
    ])
    if (usersRes.ok) {
      const data = await usersRes.json()
      setUsers(data.users ?? [])
    }
    if (logsRes.ok) {
      const data = await logsRes.json()
      setLogs(data.logs ?? [])
    }
    if (rulesRes.ok) {
      const data = await rulesRes.json()
      const rulesList: NotifRule[] = data.rules ?? []
      setRules(rulesList)
      // Build selectedUsers map from rules
      const map: Record<string, Set<string>> = {}
      for (const evt of EVENT_TYPES) {
        map[evt.key] = new Set(rulesList.filter(r => r.event_type === evt.key).map(r => r.user_id))
      }
      setSelectedUsers(map)
    }
    setLoading(false)
  }, [user])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleUser(eventType: string, userId: string) {
    setSelectedUsers(prev => {
      const current = new Set(prev[eventType] || [])
      if (current.has(userId)) current.delete(userId)
      else current.add(userId)
      return { ...prev, [eventType]: current }
    })
    // Clear saved indicator when changing
    if (rulesSaved === eventType) setRulesSaved(null)
  }

  async function saveRules(eventType: string) {
    setSavingRules(eventType)
    try {
      const userIds = Array.from(selectedUsers[eventType] || [])
      const res = await fetch('/api/notification-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, userIds }),
      })
      if (res.ok) {
        setRulesSaved(eventType)
        setTimeout(() => setRulesSaved(null), 3000)
      }
    } catch { /* ignore */ }
    setSavingRules(null)
  }

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

  const activeUsers = users.filter(u => u.is_active)

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bell className="size-6" /> Notification Center</h1>
        <p className="text-sm text-muted-foreground">Send push notifications and configure automatic alerts</p>
      </div>

      {/* Auto Notifications Config */}
      <div className="rounded-lg border bg-card p-4 space-y-5 max-w-2xl">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="size-4 text-amber-500" /> Automatic Notifications
        </h2>
        <p className="text-xs text-muted-foreground -mt-3">
          Configure which users receive automatic notifications when order statuses change. Checked every 5 minutes.
        </p>

        {EVENT_TYPES.map(evt => (
          <div key={evt.key} className="rounded-lg border border-border/60 p-3 space-y-2">
            <div>
              <p className="text-sm font-medium">{evt.label}</p>
              <p className="text-xs text-muted-foreground">{evt.description}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {activeUsers.map(u => {
                const isSelected = selectedUsers[evt.key]?.has(u.id)
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleUser(evt.key, u.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
                      isSelected
                        ? 'bg-primary/15 text-primary border border-primary/30'
                        : 'bg-muted/50 hover:bg-muted border border-transparent'
                    }`}
                  >
                    <div className={`size-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                    }`}>
                      {isSelected && <Check className="size-3 text-primary-foreground" />}
                    </div>
                    <span className="truncate">{u.full_name || u.email}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">{u.role?.replace(/_/g, ' ')}</span>
                  </button>
                )
              })}
            </div>

            <button
              onClick={() => saveRules(evt.key)}
              disabled={savingRules === evt.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                rulesSaved === evt.key
                  ? 'bg-green-500/20 text-green-500'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              } disabled:opacity-50`}
            >
              {savingRules === evt.key ? 'Saving...' : rulesSaved === evt.key ? '✅ Saved' : 'Save'}
            </button>
          </div>
        ))}
      </div>

      {/* Send notification form */}
      <div className="rounded-lg border bg-card p-4 space-y-4 max-w-2xl">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Send className="size-4" /> Send Manual Notification</h2>

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
              {activeUsers.map(u => (
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
                    {log.sent_by === 'system:cron' ? '⚡ Auto' : log.target_role ? `Role: ${log.target_role}` : log.target_user_id ? 'Specific user' : 'All users'}
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
