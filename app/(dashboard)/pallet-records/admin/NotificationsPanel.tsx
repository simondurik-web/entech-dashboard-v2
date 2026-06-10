'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { userHeaders } from '@/lib/quality/form-utils'

interface Subscriber {
  email: string
  name: string | null
  devices: number
  latest: string
}

export default function NotificationsPanel() {
  const { profile } = useAuth()
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState<string | null>(null) // null | 'all' | email
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null)

  useEffect(() => {
    if (profile?.id) loadSubscribers()
  }, [profile?.id])

  async function loadSubscribers() {
    if (!profile?.id) return

    const res = await fetch('/api/pallet-records/push/subscribers', { headers: userHeaders(profile.id) })
    if (res.ok) {
      const data = await res.json()
      setSubscribers(data.subscribers || [])
      setConfigured(data.configured !== false)
    }
    setLoading(false)
  }

  async function sendNotification(email?: string) {
    if (!title.trim() || !body.trim()) return
    setSending(email || 'all')
    setResult(null)

    if (!profile?.id) return

    try {
      const res = await fetch('/api/pallet-records/notify', {
        method: 'POST',
        headers: userHeaders(profile.id),
        body: JSON.stringify({ email, title: title.trim(), body: body.trim() }),
      })
      const data = await res.json()
      if (res.status === 501) setConfigured(false)
      setResult({ sent: data.sent || 0, failed: data.failed || 0 })
    } catch {
      setResult({ sent: 0, failed: 1 })
    }
    setSending(null)
  }

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <div className="bg-gradient-to-r from-card to-card text-white rounded-xl p-4 shadow-lg">
        <h1 className="text-xl font-bold">🔔 Push Notifications</h1>
        <p className="text-muted-foreground text-sm">
          {subscribers.length} subscribed user{subscribers.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Compose */}
      <div className="bg-card rounded-xl p-4 border border-border shadow-sm space-y-3">
        <h3 className="font-semibold text-foreground text-sm">Compose Notification</h3>
        {!configured && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Push not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to send notifications.
          </p>
        )}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="w-full border-2 border-border rounded-lg p-3 text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:border-sky-400 focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body"
          rows={3}
          className="w-full border-2 border-border rounded-lg p-3 text-foreground placeholder:text-muted-foreground focus:border-sky-500 dark:border-sky-400 focus:outline-none resize-none"
        />
        <button
          onClick={() => sendNotification()}
          disabled={!configured || !title.trim() || !body.trim() || !!sending}
          className="w-full py-3 bg-sky-600 text-white rounded-lg font-semibold active:bg-sky-700 disabled:opacity-50 shadow-sm"
        >
          {sending === 'all' ? 'Sending...' : '📢 Send to All'}
        </button>
        {result && (
          <p className="text-sm text-center text-muted-foreground">
            ✅ Sent: {result.sent} · ❌ Failed: {result.failed}
          </p>
        )}
      </div>

      {/* Subscribers */}
      {loading ? (
        <div className="text-center py-8">
          <div className="w-8 h-8 border-4 border-sky-600 dark:border-sky-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      ) : subscribers.length === 0 ? (
        <div className="text-center py-8 bg-card rounded-xl shadow-sm">
          <p className="text-muted-foreground">No subscribers yet</p>
          <p className="text-muted-foreground text-sm mt-1">Users will see a prompt to enable notifications</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subscribers.map((sub) => (
            <div key={sub.email} className="bg-card rounded-xl p-4 border border-border shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-sky-100 dark:bg-sky-950 flex items-center justify-center text-sky-600 dark:text-sky-400 font-semibold">
                  {(sub.name || sub.email)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">{sub.name || sub.email}</p>
                  <p className="text-sm text-muted-foreground truncate">{sub.email}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
                    📱 {sub.devices} device{sub.devices !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => sendNotification(sub.email)}
                  disabled={!configured || !title.trim() || !body.trim() || !!sending}
                  className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-50 text-muted-foreground font-medium"
                >
                  {sending === sub.email ? 'Sending...' : '🔔 Send Test'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
